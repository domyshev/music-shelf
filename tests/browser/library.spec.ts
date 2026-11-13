import { test, expect } from '@playwright/test';
const tracks = Array.from({ length: 5000 }, (_, index) => ({ id: `fixture-${index}`, title: `Fictional song ${String(index).padStart(4, '0')}`, artist: `Demo Artist ${index % 7}`, album: 'Synthetic album', year: 1960 + index % 10, status: 'pending', file: null }));
test.beforeEach(async ({ page }) => {
  let translationLanguage='ru';let autoTranslate=false;
  await page.route('**/api/preferences',route=>{if(route.request().method()==='PUT'){const data=route.request().postDataJSON();translationLanguage=data.translationLanguage??translationLanguage;autoTranslate=data.autoTranslate??autoTranslate;}return route.fulfill({json:{translationLanguage,autoTranslate}});});
  await page.route('**/api/tracks/*/phrases',route=>route.fulfill({json:{phrases:[]}}));
  let maxTokens:number|null=null;
  await page.route('**/api/ai/output-limit',route=>{if(route.request().method()==='PUT')maxTokens=route.request().postDataJSON().maxTokens;return route.fulfill({json:{maxTokens}});});
  await page.route('**/api/ai/chat/turn/*', route=>route.fulfill({json:{state:'complete',reply:'Done'}}));
  await page.route('**/api/catalog?*', route => {
    const params = new URL(route.request().url()).searchParams;
    const query = (params.get('q') ?? '').toLowerCase();
    const matching = tracks.filter(track => `${track.title} ${track.artist}`.toLowerCase().includes(query));
    if (params.get('sort') === 'title') matching.sort((a, b) => a.title.localeCompare(b.title) * (params.get('direction') === 'desc' ? -1 : 1));
    const page = Number(params.get('page') ?? 1); const pageSize = Number(params.get('pageSize') ?? 100);
    return route.fulfill({ json: { generatedAt: '2026-01-01T12:00:00.000Z', tracks: matching.slice((page - 1) * pageSize, page * pageSize), tagOptions:[{id:'12345678-1234-4234-8234-123456789abc',name:'agent-moon.dust-2'}], stats: { total: 5000, ready: 0, pending: 5000, sizeBytes: 0 }, pagination: { page, pageSize, total: matching.length, pages: Math.ceil(matching.length / pageSize) }, facets: { status: ['pending'], artist: [...new Set(tracks.map(track => track.artist))], year: ['1960'] } } });
  });
  await page.route('**/api/history?*', route => route.fulfill({ json: { total: 2, events: [{ id: 2, trackId: 'fixture-2', title: 'Newer fictional song', artist: 'Demo Artist', kind: 'downloaded', occurredAt: '2026-01-02T12:00:00.000Z', timeBasis: 'source' }, { id: 1, trackId: 'fixture-1', title: 'Older fictional song', artist: 'Demo Artist', kind: 'imported', occurredAt: '2026-01-01T12:00:00.000Z', timeBasis: 'import' }], nextCursor: null } }));
  let authenticated = false;
  await page.route('**/api/session', route => route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? { ok: true, email: 'test@example.invalid' } : { error: 'Sign in required' } }));
  await page.route('**/api/auth/request-code', route => route.fulfill({ json: { ok: true, challengeId: 'x'.repeat(32), expiresIn: 600, resendAfter: 60 } }));
  await page.route('**/api/auth/verify-code', route => { authenticated = true; return route.fulfill({ json: { ok: true, email: 'test@example.invalid' } }); });
  await page.route('**/api/auth/logout', route => { authenticated = false; return route.fulfill({ json: { ok: true } }); });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('test@example.invalid');
  await page.getByRole('button', { name: 'Send code', exact: true }).click();
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Songs', exact: true })).toBeVisible();
});
test('shows account, theme, settings and version in the application menu',async({page})=>{
 await page.getByRole('button',{name:'Open menu'}).click();
 const menu=page.getByRole('menu');await expect(menu.getByText('Theme:')).toBeVisible();await expect(menu.getByText('test@example.invalid')).toBeVisible();
 await expect(menu.getByText('0.2.36')).toBeVisible();await expect(menu.getByRole('menuitem',{name:'Settings'})).toBeVisible();
 await menu.getByRole('menuitem',{name:/About/}).click();await expect(page.getByRole('dialog',{name:'About Music Shelf'})).toContainText('0.2.36');
});
test('marks overlapping translated phrases and supports quick AI translation',async({page})=>{
 await page.route('**/api/tracks/*/text',route=>route.fulfill({json:{originalLanguage:'es',texts:{es:'> Gracias a la vida\n> Gracias a la vida',ru:'',en:''}}}));
 await page.route('**/api/tracks/*/phrases',route=>route.fulfill({json:{phrases:[{sourceLanguage:'es',word:'gracias'},{sourceLanguage:'es',word:'gracias a la vida'}]}}));
 await page.route('**/api/tracks/*/words?*',route=>route.fulfill({json:{translations:[]}}));
 await page.getByRole('button',{name:'Fictional song 0000',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Song details'});const line=dialog.locator('.lyrics-line').first();
 const spans=line.locator('.translated-phrase');await expect(spans.first()).toBeVisible();
 expect(await spans.first().evaluate(el=>getComputedStyle(el,'::after').backgroundImage.split('gradient').length-1)).toBe(2);
 await line.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);});await line.dispatchEvent('mouseup');
 const tip=page.getByRole('dialog',{name:'Word or phrase translation'});await expect(tip.getByRole('button',{name:'Add translation'})).toBeVisible();await expect(tip.getByRole('button',{name:'Translate selection with AI'})).toBeVisible();
});
test('quick AI translation uses the account default language',async({page})=>{
 let request='';let translated=false;
 await page.route('**/api/preferences',route=>route.fulfill({json:{translationLanguage:'fr',autoTranslate:false}}));
 await page.route('**/api/tracks/*/text',route=>route.fulfill({json:{originalLanguage:'es',texts:{es:'Gracias',ru:'',en:''}}}));
 await page.route('**/api/tracks/*/words?*',route=>route.fulfill({json:{translations:translated?[{id:1,targetLanguage:'fr',translation:'Merci',ai:true}]:[]}}));
 await page.route('**/api/ai/chat',route=>{request=route.request().postDataJSON().message;translated=true;return route.fulfill({json:{state:'pending'}});});
 await page.getByRole('button',{name:'Fictional song 0000',exact:true}).click();const line=page.locator('.lyrics-markdown p');await line.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);});await line.dispatchEvent('mouseup');
 const tip=page.getByRole('dialog',{name:'Word or phrase translation'});await tip.getByRole('button',{name:'Translate selection with AI'}).click();await expect.poll(()=>request).toContain('target language: fr');await expect(tip).toContainText('Merci');
});
test('automatically translates a missing phrase and shows progress in place',async({page})=>{
 let sent=0,translated=false;let finish!:()=>void;const waiting=new Promise<void>(resolve=>finish=resolve);
 await page.route('**/api/preferences',route=>route.fulfill({json:{translationLanguage:'ru',autoTranslate:true}}));
 await page.route('**/api/tracks/*/text',route=>route.fulfill({json:{originalLanguage:'es',texts:{es:'Blanco',ru:'',en:''}}}));
 await page.route('**/api/tracks/*/words?*',route=>route.fulfill({json:{translations:translated?[{id:1,targetLanguage:'ru',translation:'белый',ai:true}]:[]}}));
 await page.route('**/api/ai/chat',async route=>{sent++;await waiting;translated=true;await route.fulfill({json:{state:'pending'}});});
 await page.getByRole('button',{name:'Fictional song 0000',exact:true}).click();const line=page.locator('.lyrics-markdown p');await line.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);});await line.dispatchEvent('mouseup');
 const tip=page.getByRole('dialog',{name:'Word or phrase translation'});await expect(tip).toContainText('Translating with AI');await expect(tip.getByRole('status',{name:'Translating'})).toBeVisible();await expect(tip).not.toContainText('No saved translation');await expect(tip.getByRole('button',{name:'Add translation'})).toHaveCount(0);expect(sent).toBe(1);
 finish();await expect(tip).toContainText('белый');await expect(tip.getByText('AI',{exact:true})).toBeVisible();
 await line.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);});await line.dispatchEvent('mouseup');await expect(tip).toContainText('белый');expect(sent).toBe(1);
});
test('shows a failed AI translation and retries it without claiming no translation',async({page})=>{
 let calls=0;let translated=false;
 await page.route('**/api/preferences',route=>route.fulfill({json:{translationLanguage:'ru',autoTranslate:true}}));
 await page.route('**/api/tracks/*/text',route=>route.fulfill({json:{originalLanguage:'es',texts:{es:'Blanco',ru:'',en:''}}}));
 await page.route('**/api/tracks/*/words?*',route=>route.fulfill({json:{translations:translated?[{id:1,targetLanguage:'ru',translation:'белый',ai:true}]:[]}}));
 await page.route('**/api/ai/chat',route=>{calls++;if(calls===2)translated=true;return route.fulfill({json:{state:'pending'}});});
 await page.getByRole('button',{name:'Fictional song 0000',exact:true}).click();const line=page.locator('.lyrics-markdown p');await line.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);});await line.dispatchEvent('mouseup');
 const tip=page.getByRole('dialog',{name:'Word or phrase translation'});await expect(tip).toContainText('The agent could not translate.');await expect(tip).not.toContainText('No saved translation');await expect(page.getByRole('alert').filter({hasText:'Unable to translate with AI.'})).toBeVisible();
 await tip.getByRole('button',{name:'Retry translation'}).click();await expect(tip).toContainText('белый');await expect(tip).not.toContainText('The agent could not translate.');expect(calls).toBe(2);
});
test('selects the saved output token limit inside the assistant input',async({page})=>{
 await page.getByRole('button',{name:'AI assistant',exact:true}).click();
 const limit=page.getByRole('combobox',{name:'Output tokens'});await expect(limit).toHaveText('Output tokens: Auto');
 await limit.click();await page.getByRole('option',{name:'16,384'}).click();await expect(limit).toHaveText('Output tokens: 16,384');
 await page.reload();await page.getByRole('button',{name:'AI assistant',exact:true}).click();await expect(limit).toHaveText('Output tokens: 16,384');
 await limit.click();await page.getByRole('option',{name:'Automatic'}).click();await expect(limit).toHaveText('Output tokens: Auto');
});
test('shows assistant usage and repeats a question as a new request',async({page})=>{
 let sent='';const turns=[{id:1,requestId:'prior',message:'Find songs',reply:'Here they are',state:'complete',createdAt:'2026-01-01T00:00:00Z',metrics:{inputTokens:100,outputTokens:50,cost:.002,durationMs:2500}}];
 await page.route('**/api/ai/chat/history*',route=>route.fulfill({json:{turns,nextBefore:null}}));
 await page.route('**/api/ai/settings',route=>route.fulfill({json:{model:'demo/model',hasToken:true}}));
 await page.route('**/api/ai/chat',route=>{sent=route.request().postDataJSON().message;return route.fulfill({json:{state:'pending'}});});
 await page.getByRole('button',{name:'AI assistant',exact:true}).click();await expect(page.getByText('150 tokens · $0.002000 · 2.5 s')).toBeVisible();
 await page.getByRole('button',{name:'Repeat request'}).click();await expect.poll(()=>sent).toBe('Find songs');
});
test('reorders lyric tabs by dragging and remembers order for other songs',async({page})=>{
 await page.route('**/api/tracks/*/text',route=>route.fulfill({json:{originalLanguage:'en',texts:{en:'English text',ru:'Russian text',es:'Spanish text',fr:'French text'}}}));
 await page.getByRole('button',{name:'Fictional song 0000',exact:true}).click();
 let dialog=page.getByRole('dialog',{name:'Song details'});const tablist=dialog.getByRole('tablist',{name:'Lyrics languages'});
 await expect(tablist.getByRole('tab')).toHaveText(['ru','es','en','fr']);
 const from=await tablist.getByRole('tab',{name:'en'}).boundingBox(),to=await tablist.getByRole('tab',{name:'ru'}).boundingBox();
 if(!from||!to)throw new Error('Language tabs not found');
 await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:8});await page.mouse.up();
 await expect(tablist.getByRole('tab')).toHaveText(['en','ru','es','fr']);
 await expect(tablist.getByRole('tab',{name:'en'})).toHaveAttribute('aria-selected','false');
 await expect(dialog.locator('.lyrics-column').first()).toHaveAttribute('data-language','ru');
 await dialog.getByRole('button',{name:'Close details'}).click();await page.getByRole('button',{name:'Fictional song 0001',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'Song details'});await expect(dialog.getByRole('tablist',{name:'Lyrics languages'}).getByRole('tab')).toHaveText(['en','ru','es','fr']);
 await expect(dialog.getByRole('tab',{name:'en'})).toHaveAttribute('aria-selected','true');await expect(dialog.locator('.lyrics-column').first()).toHaveAttribute('data-language','en');
 await page.reload();await page.getByRole('button',{name:'Fictional song 0000',exact:true}).click();await expect(page.getByRole('dialog',{name:'Song details'}).getByRole('tablist',{name:'Lyrics languages'}).getByRole('tab')).toHaveText(['en','ru','es','fr']);
});
test('virtualizes a large library, scrolls the table only, searches, sorts and retains login', async ({ page }) => {
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: '250', exact: true }).click();
  expect(await page.getByTestId('track-row').count()).toBeLessThan(100);
  const scroll = page.getByTestId('library-scroll');
  await scroll.hover(); await page.mouse.wheel(0, 500000);
  await expect(page.getByRole('button', { name: 'Fictional song 0249', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole('button', { name: 'Go to next page' }).click();
  await expect(page.getByRole('button', { name: 'Fictional song 0250', exact: true })).toBeVisible();
  await page.getByPlaceholder('Search songs, artists and albums').fill('Fictional song 0123');
  await expect(page.getByTestId('track-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.getByRole('button', { name: 'Song', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Song' })).toHaveAttribute('aria-sort', 'ascending');
  await page.reload();
  await expect(page.getByRole('table', { name: 'Songs', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveCount(0);
});
test('persists page size and current page, and clamps stale pages', async ({page}) => {
  await page.getByRole('combobox').click();await page.getByRole('option',{name:'500',exact:true}).click();
  await expect(page.getByText('1–500 of 5,000')).toBeVisible();
  await page.getByRole('button',{name:'Go to next page'}).click();
  await expect(page.getByText('501–1,000 of 5,000')).toBeVisible();
  await page.reload();await expect(page.getByText('501–1,000 of 5,000')).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveText('500');
  await page.getByRole('combobox').click();await page.getByRole('option',{name:'1000',exact:true}).click();
  await expect(page.getByText('1–1,000 of 5,000')).toBeVisible();
  await page.reload();await expect(page.getByRole('combobox')).toHaveText('1000');
  await page.evaluate(()=>{const key='music-shelf.preferences';const value=JSON.parse(localStorage.getItem(key)!);value.page=99;localStorage.setItem(key,JSON.stringify(value));});
  await page.reload();await expect(page.getByText('4,001–5,000 of 5,000')).toBeVisible();
});
test('configures all column filters from the search toolbar and resets them',async({page})=>{
  await page.getByRole('button',{name:'Filters',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Configure filters'});
  await expect(dialog.getByLabel('Status')).toBeVisible();await expect(dialog.getByLabel('Artist / band')).toBeVisible();await expect(dialog.getByLabel('Year')).toBeVisible();
  await dialog.getByLabel('Status').click();await page.getByRole('option',{name:'pending'}).click();await page.keyboard.press('Escape');
  await dialog.getByLabel('Artist / band').click();await page.getByRole('option',{name:'Demo Artist 1'}).click();await page.keyboard.press('Escape');
  await dialog.getByLabel('Year').click();await page.getByRole('option',{name:'1960'}).click();
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Filters',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect.poll(async()=>page.evaluate(()=>JSON.parse(localStorage.getItem('music-shelf.preferences')!).columnFilters.length)).toBe(3);
  await page.reload();await expect(page.getByRole('button',{name:'Filters',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Filter actions'}).click();await page.getByRole('menuitem',{name:'Reset all filters'}).click();
  await expect(page.getByRole('button',{name:'Filters',exact:true})).toHaveAttribute('aria-pressed','false');
  await expect.poll(async()=>page.evaluate(()=>JSON.parse(localStorage.getItem('music-shelf.preferences')!).columnFilters.length)).toBe(0);
});
test('filters every catalog column including tag and calendar dates',async({page})=>{
  await page.getByRole('button',{name:'Filters',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Configure filters'});
  await dialog.getByLabel('Song',{exact:true}).fill('Song 0001');
  await dialog.getByLabel('Tags').click();await page.getByRole('option',{name:'agent-moon.dust-2'}).click();await page.keyboard.press('Escape');
  for(const label of ['Sample rate (Hz)','Bit depth','Size (bytes)','Attempts'])await dialog.getByLabel(`${label} min`).fill('1');
  await dialog.getByRole('button',{name:'Queued at date range'}).click();
  await page.getByLabel('From',{exact:true}).fill('2026-01-01');await page.getByLabel('To',{exact:true}).fill('2026-01-03');await page.getByRole('button',{name:'Apply',exact:true}).click();
  await dialog.getByRole('button',{name:'Downloaded at date range'}).click();
  await page.getByLabel('From',{exact:true}).fill('2026-02-01');await page.getByLabel('To',{exact:true}).fill('2026-02-02');await page.getByRole('button',{name:'Apply',exact:true}).click();
  await expect.poll(async()=>page.evaluate(()=>JSON.parse(localStorage.getItem('music-shelf.preferences')!).columnFilters.length)).toBe(8);
  await page.keyboard.press('Escape');await page.reload();await page.getByRole('button',{name:'Filters',exact:true}).click();await expect(page.getByRole('dialog',{name:'Configure filters'}).getByLabel('Song',{exact:true})).toHaveValue('Song 0001');
});
test('opens newest-first history and keeps logout inside the menu', async ({ page }) => {
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Download history' }).click();
  await expect(page.getByRole('table', { name: 'Download history', exact: true })).toBeVisible();
  await expect(page.getByTestId('history-row').first()).toContainText('Newer fictional song');
  await page.getByRole('button', { name: 'Close history' }).click();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeVisible();
});
test('fits a phone viewport without document scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const documentFits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight);
  expect(documentFits).toBe(true);
  await expect(page.getByTestId('library-scroll')).toBeVisible();
});

test('artist links keep their color, underline on hover and open an accessible card', async ({ page }) => {
  const artist = page.getByRole('button', { name: 'Artist / band: Demo Artist 0', exact: true }).first();
  const color = await artist.evaluate(element => getComputedStyle(element).color);
  await artist.hover();
  await expect(artist).toHaveCSS('text-decoration-line', 'underline');
  await expect(artist).toHaveCSS('color', color);
  await artist.click();
  const card = page.getByRole('dialog', { name: 'Artist / band: Demo Artist 0', exact: true });
  await expect(card).toContainText('Demo Artist 0');
  await card.getByRole('button', { name: 'Close artist card' }).click();
  await expect(card).toHaveCount(0);
});

test('song metadata aligns icons with names and previews artist and album cards with arrows', async ({ page }) => {
  await page.getByRole('button', { name: 'Fictional song 0000', exact: true }).click();
  const song = page.getByRole('dialog');
  for (const row of await song.locator('.track-metadata-row').all()) {
    const centers = await row.evaluate(element => {
      const icon = element.querySelector('svg')!.getBoundingClientRect();
      const label = element.querySelector('button')!.getBoundingClientRect();
      return { icon: icon.y + icon.height / 2, label: label.y + label.height / 2 };
    });
    expect(Math.abs(centers.icon - centers.label)).toBeLessThanOrEqual(1);
  }
  const artist = song.getByRole('button', { name: 'Artist / band: Demo Artist 0', exact: true });
  await artist.hover();
  const preview = page.getByRole('tooltip');
  await expect(preview).toContainText('Demo Artist 0');
  await expect(preview.locator('.MuiTooltip-arrow')).toHaveCount(1);
  await preview.hover();
  await expect(preview).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  const album = song.getByRole('button', { name: 'Album: Synthetic album', exact: true });
  const color = await album.evaluate(element => getComputedStyle(element).color);
  await album.hover();
  await expect(album).toHaveCSS('text-decoration-line', 'underline');
  await expect(album).toHaveCSS('color', color);
  await expect(page.getByRole('tooltip')).toContainText('Synthetic album');
  await album.click();
  const card = page.getByRole('dialog', { name: 'Album: Synthetic album', exact: true });
  await expect(card).toContainText('Synthetic album');
  await card.getByRole('button', { name: 'Close album card' }).click();
  await expect(song).toBeVisible();
});

test('edits lyrics and configures the AI drawer', async ({ page }) => {
  let text = {originalLanguage:'en',texts:{en:'',ru:'',es:''}};
  await page.route('**/api/tracks/*/text', async route => {
    if (route.request().method()==='PUT') {text={...text,...route.request().postDataJSON()};await route.fulfill({json:{ok:true}});} else await route.fulfill({json:text});
  });
  await page.route('**/api/tracks/*/language', route=>{text.originalLanguage=route.request().postDataJSON().language;return route.fulfill({json:{ok:true}});});
  let hasToken=false;
  await page.route('**/api/ai/settings', route => {if(route.request().method()==='PUT'){const body=route.request().postDataJSON();hasToken=body.removeToken?false:!!body.token||hasToken;}return route.fulfill({json:{model:'demo/model',hasToken}});});
  await page.route('**/api/ai/models', route => route.fulfill({json:{models:[{id:'demo/model',name:'Demo model',supportsTools:true}]}}));
  const turns:{id:number;requestId:string;message:string;reply:string;state:string;createdAt:string}[]=[];
  await page.route('**/api/ai/chat/history*', route => route.fulfill({json:{turns,nextBefore:null}}));
  await page.route('**/api/ai/chat', route => {const body=route.request().postDataJSON();turns.push({id:turns.length+1,requestId:body.requestId,message:body.message,reply:'A demo reply',state:'complete',createdAt:'2026-01-01T00:00:00Z'});return route.fulfill({json:{reply:'A demo reply'}});});
  await page.getByRole('button', {name:'Fictional song 0000',exact:true}).click();
  await page.getByLabel('Lyrics en',{exact:true}).fill('Some lyrics');
  await page.getByRole('tab',{name:'ru',exact:true}).click();
  await page.getByLabel('Lyrics ru',{exact:true}).fill('Some translation');
  await page.getByRole('button',{name:'Save lyrics'}).click();
  await expect(page.getByText('Saved',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close details'}).click();
  await page.getByRole('button', {name:'Fictional song 0000',exact:true}).click();
  await page.getByRole('button',{name:'Edit lyrics',exact:true}).click();await expect(page.getByLabel('Lyrics en',{exact:true})).toHaveValue('Some lyrics');
  await expect(page.getByLabel('Lyrics ru',{exact:true})).toHaveValue('Some translation');
  await page.getByRole('button',{name:'Add language'}).click();await page.getByRole('combobox',{name:'Language',exact:true}).click();await page.getByRole('option',{name:'French',exact:true}).click();await page.getByRole('button',{name:'Add',exact:true}).click();
  await page.getByRole('combobox',{name:'Original language'}).click();await page.getByRole('option',{name:'French',exact:true}).click();
  await page.getByLabel('Lyrics fr',{exact:true}).fill('Paroles');await page.getByRole('button',{name:'Save lyrics'}).click();await expect(page.getByText('Saved',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close details'}).click();await page.getByRole('button',{name:'Fictional song 0000',exact:true}).click();await expect(page.getByRole('combobox',{name:'Original language'})).toHaveText('fr');await page.getByRole('tab',{name:'fr',exact:true}).click();await expect(page.getByText('Paroles',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Close details'}).click();
  await page.getByRole('button',{name:'AI assistant',exact:true}).click();
  await page.getByRole('button',{name:'Agent menu'}).click();await page.getByRole('menuitem',{name:'Agent settings'}).click();
  await page.getByLabel('OpenRouter API token').fill('sample-key');
  await page.getByRole('combobox',{name:'OpenRouter model'}).click();await page.getByRole('option',{name:'Demo model (demo/model)'}).click();
  await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByText('Settings saved')).toBeVisible();
  const token=page.getByLabel('Replace API token');await expect(token).toHaveAttribute('type','password');await expect(token).toHaveAttribute('placeholder','●●●●●●●●●●●●');await expect(token).toHaveValue('');await expect(page.getByRole('button',{name:'Remove token'})).toBeVisible();await page.screenshot({path:'/tmp/music-shelf-settings-026.png'});await page.getByRole('button',{name:'Remove token'}).click();await expect(page.getByLabel('OpenRouter API token')).toBeVisible();await page.getByLabel('OpenRouter API token').fill('replacement-key');await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByLabel('Replace API token')).toHaveAttribute('placeholder','●●●●●●●●●●●●');
  await page.getByRole('button',{name:'Back to chat'}).click();await page.getByLabel('Message AI').fill('Hello');await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByText('A demo reply')).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'AI assistant',exact:true}).click();await expect(page.getByText('Hello',{exact:true})).toBeVisible();await expect(page.getByText('A demo reply')).toBeVisible();
});

test('uses the turntable mark and monochrome themes', async ({ page }) => {
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href','/music-shelf.svg');
  const icon=page.locator('.app-header .wordmark-icon');await expect(icon).toBeVisible();
  expect(await icon.evaluate((image: HTMLImageElement)=>image.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Open menu'}).click();await page.getByRole('button',{name:'Light theme'}).click();await page.keyboard.press('Escape');
  await expect(page.locator('.app-shell')).toHaveCSS('background-color','rgb(243, 243, 243)');
  await page.screenshot({path:'/tmp/music-shelf-light-024.png'});
  await page.getByRole('button',{name:'Open menu'}).click();await page.getByRole('button',{name:'Dark theme'}).click();await page.keyboard.press('Escape');
  await expect(page.locator('.app-shell')).toHaveCSS('background-color','rgb(20, 20, 20)');
  await page.screenshot({path:'/tmp/music-shelf-dark-024.png'});
});


test('formats AI replies, sends with Enter and remembers the drawer width', async ({ page }) => {
  const turns:{id:number;requestId:string;message:string;reply:string;state:string;createdAt:string}[]=[];
  await page.route('**/api/ai/settings', route=>route.fulfill({json:{model:'demo/model',hasToken:true}}));
  await page.route('**/api/ai/chat/history*', route=>route.fulfill({json:{turns,nextBefore:null}}));
  await page.route('**/api/ai/chat', route=>{const body=route.request().postDataJSON();turns.push({id:1,requestId:body.requestId,message:body.message,reply:'**Bold** and *italic*\n\n| Song | Status |\n| --- | --- |\n| Hey Joe | ready |\n\n- One\n- Two\n\n[unsafe](javascript:alert(1))',state:'complete',createdAt:'2026-01-01T00:00:00Z'});return route.fulfill({json:{reply:'ok'}});});
  const aiButton=page.getByRole('button',{name:'AI assistant',exact:true});await expect(aiButton).toBeVisible();
  const versionLabel=page.locator('.app-header').getByText(/^\d+\.\d+\.\d+$/);const buttonRect=await aiButton.boundingBox();const versionRect=await versionLabel.boundingBox();expect(versionRect!.x-(buttonRect!.x+buttonRect!.width)).toBeCloseTo(30,0);
  await aiButton.click();await expect(page.getByText('Я хранитель твоей музыки. Чего надобно старец')).toBeVisible();
  const input=page.getByLabel('Message AI');await input.fill('First line');await input.press('Shift+Enter');await input.pressSequentially('Second line');await expect(input).toHaveValue('First line\nSecond line');expect(turns).toHaveLength(0);
  await input.press('Enter');await expect(page.getByText('Bold',{exact:true})).toBeVisible();expect(turns[0].message).toBe('First line\nSecond line');
  await expect(page.locator('.ai-markdown strong')).toHaveText('Bold');await expect(page.locator('.ai-markdown em')).toHaveText('italic');await expect(page.locator('.ai-markdown table')).toContainText('Hey Joe');expect(await page.locator('.ai-markdown a').getAttribute('href')).not.toMatch(/^javascript:/i);await expect(page.getByRole('img',{name:'Music Shelf assistant'})).toBeVisible();
  const handle=page.getByRole('separator',{name:'Resize assistant panel'});await expect(handle).toBeVisible();const before=Number(await handle.getAttribute('aria-valuenow'));const rect=await handle.boundingBox();await page.mouse.move(rect!.x+5,rect!.y+rect!.height/2);await page.mouse.down();await page.mouse.move(rect!.x-115,rect!.y+rect!.height/2,{steps:5});await page.mouse.up();const after=Number(await handle.getAttribute('aria-valuenow'));expect(after).toBeGreaterThan(before+80);
  await page.screenshot({path:'/tmp/music-shelf-ai-025.png'});
  await page.reload();await page.getByRole('button',{name:'AI assistant',exact:true}).click();await expect(page.getByRole('separator',{name:'Resize assistant panel'})).toHaveAttribute('aria-valuenow',String(after));await expect(page.locator('.ai-markdown table')).toContainText('Hey Joe');
  await page.getByRole('separator',{name:'Resize assistant panel'}).focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('separator',{name:'Resize assistant panel'})).toHaveAttribute('aria-valuenow',String(after-24));
});


test('song languages share scrolling and panels can dock or resize', async ({page}) => {
 const lines=Array.from({length:80},(_,i)=>`Line ${i+1}`).join('\n');
 await page.route('**/api/tracks/*/text',route=>route.fulfill({json:{originalLanguage:'en',texts:{en:lines,ru:lines,es:''}}}));
 await page.getByRole('button',{name:'Fictional song 0000',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Song details'});const en=dialog.getByRole('tab',{name:'en',exact:true});await expect(en).not.toContainText('original');
 await dialog.getByRole('button',{name:'Edit lyrics',exact:true}).click();await expect(dialog.getByLabel('Lyrics en')).toBeVisible();await expect(dialog.getByLabel('Lyrics ru')).toBeVisible();await page.screenshot({path:'/tmp/music-shelf-song-026.png'});
 const scroll=dialog.getByTestId('lyrics-scroll');expect(await scroll.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);await scroll.evaluate(e=>e.scrollTop=200);expect(await scroll.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);await expect(dialog.getByRole('tab',{name:'en'})).toBeVisible();
 const topBefore=await dialog.getByRole('button',{name:'Close details'}).boundingBox();await scroll.evaluate(e=>e.scrollTop=400);const topAfter=await dialog.getByRole('button',{name:'Close details'}).boundingBox();expect(topAfter!.y).toBe(topBefore!.y);
 await dialog.getByRole('button',{name:'Dock left'}).click();await expect(dialog).toHaveClass(/window-left/);let widthHandle=dialog.getByRole('separator',{name:'Resize song panel'});let width=Number(await widthHandle.getAttribute('aria-valuenow'));await widthHandle.focus();await page.keyboard.press('ArrowRight');await expect(widthHandle).toHaveAttribute('aria-valuenow',String(width+24));
 await dialog.getByRole('button',{name:'Dock right'}).click();await expect(dialog).toHaveClass(/window-right/);width=Number(await widthHandle.getAttribute('aria-valuenow'));await widthHandle.focus();await page.keyboard.press('ArrowLeft');await expect(widthHandle).toHaveAttribute('aria-valuenow',String(width+24));
 await dialog.getByRole('button',{name:'Open as dialog'}).click();await expect(dialog).toHaveClass(/window-modal/);width=Number(await widthHandle.getAttribute('aria-valuenow'));await widthHandle.focus();await page.keyboard.press('ArrowRight');await expect(widthHandle).toHaveAttribute('aria-valuenow',String(width+24));
 const heightHandle=dialog.getByRole('separator',{name:'Resize panel height'});const initial=Number(await heightHandle.getAttribute('aria-valuenow'));await heightHandle.focus();await page.keyboard.press('ArrowUp');await expect(heightHandle).toHaveAttribute('aria-valuenow',String(initial-24));
 await dialog.getByRole('button',{name:'Close details'}).click();await page.getByRole('button',{name:'AI assistant',exact:true}).click();const ai=page.getByRole('dialog',{name:'AI assistant'});await ai.getByRole('button',{name:'Dock left'}).click();await expect(ai).toHaveClass(/window-left/);await ai.getByRole('button',{name:'Open as dialog'}).click();await expect(ai.getByRole('separator',{name:'Resize panel height'})).toBeVisible();
});


test('ready song metadata stays fixed while only lyrics scroll', async ({page}) => {
 const lines=Array.from({length:100},(_,i)=>`Lyrics line ${i+1}`).join('\n');
 const track={id:'ready-song',title:'A real-shaped song',artist:'Demo Artist',album:'Demo Album',year:1968,status:'ready',file:{name:'song.flac',sizeBytes:1024,sha256:'a'.repeat(64),format:'flac',codec:'flac',sampleRate:44100,bitDepth:16,channels:2,durationSeconds:180,bitrateBps:900000}};
 await page.route('**/api/catalog?*',route=>route.fulfill({json:{generatedAt:'2026-01-01T00:00:00Z',tracks:[track],stats:{total:1,ready:1,pending:0,sizeBytes:1024},pagination:{page:1,pageSize:25,total:1,pages:1},facets:{status:['ready'],artist:['Demo Artist'],year:['1968']}}}));
 await page.route('**/api/tracks/*/text',route=>route.fulfill({json:{originalLanguage:'en',texts:{en:lines,ru:lines,es:''}}}));
 await page.reload();await page.getByRole('button',{name:'A real-shaped song'}).click();const dialog=page.getByRole('dialog',{name:'Song details'});
 const scroll=dialog.getByTestId('lyrics-scroll');await expect(scroll).toBeVisible();expect(await scroll.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
 const file=dialog.getByText('song.flac',{exact:true});await expect(file).toBeVisible();const before=await file.boundingBox();await scroll.evaluate(e=>e.scrollTop=500);expect((await file.boundingBox())!.y).toBe(before!.y);await expect(dialog.getByText('Saved',{exact:true})).toBeVisible();
 await page.screenshot({path:'/tmp/music-shelf-ready-026.png'});
 await page.setViewportSize({width:390,height:844});await expect(dialog.locator('.lyrics-markdown').first()).toBeVisible();await expect(dialog.getByText('Saved',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


test('renders song Markdown blocks and resizes metadata independently', async ({page}) => {
 await page.route('**/api/tracks/*/text',route=>route.fulfill({json:{originalLanguage:'fr',texts:{fr:'> Premier vers\n> Deuxième vers\n\nPlain text',ru:'> Первая строка\n> Вторая строка',en:'',es:''}}}));
 await page.getByRole('button',{name:'Fictional song 0000',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Song details'});
 await expect(dialog.getByRole('combobox',{name:'Original language'})).toHaveText('fr');
 await expect(dialog.getByRole('tab')).toHaveText(['ru','es','en','fr']);
 await dialog.getByRole('combobox',{name:'Original language'}).click();
 const options=page.getByRole('option');await expect(options.nth(0)).toHaveText('Russian');await expect(options.nth(1)).toHaveText('Spanish');await expect(options.nth(2)).toHaveText('English');await expect(options.filter({hasText:'Russian'})).toHaveCount(1);await page.keyboard.press('Escape');await expect(options.first()).not.toBeVisible();await expect(page.locator('.MuiBackdrop-invisible')).toHaveCount(0);
 await expect(dialog.locator('.lyrics-markdown blockquote').last()).toContainText('Premier vers');
 await expect(dialog.locator('.lyrics-markdown blockquote')).toHaveCount(2);await expect(dialog.locator('.lyrics-column-heading')).toHaveCount(0);
 await expect(dialog.locator('.lyrics-column').first()).toContainText('Первая строка');await expect(dialog.locator('.lyrics-column').last()).toContainText('Premier vers');
 const metadata=dialog.locator('.song-metadata');const before=(await metadata.boundingBox())!.height;
 const divider=dialog.getByRole('separator',{name:'Resize song information and lyrics'});const rect=(await divider.boundingBox())!;
 await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2+70,{steps:5});await page.mouse.up();
 expect((await metadata.boundingBox())!.height).toBeGreaterThan(before+50);
 await divider.focus();await page.keyboard.press('ArrowUp');const savedHeight=(await metadata.boundingBox())!.height;expect(savedHeight).toBeLessThan(before+60);
 await dialog.getByRole('button',{name:'Close details'}).click();await page.getByRole('button',{name:'Fictional song 0001',exact:true}).click();await expect(page.locator('.song-metadata')).toHaveCSS('height',`${savedHeight}px`);await page.reload();await page.getByRole('button',{name:'Fictional song 0000',exact:true}).click();await expect(page.locator('.song-metadata')).toHaveCSS('height',`${savedHeight}px`);
});


test('shows a saved word translation above the selected word',async({page})=>{
 await page.route('**/api/tracks/*/text',route=>route.fulfill({json:{originalLanguage:'en',texts:{en:'Love is all',ru:'',es:''}}}));
 await page.route('**/api/tracks/*/words?*',route=>{const url=new URL(route.request().url());expect(url.searchParams.get('word')).toBe('Love');expect(url.searchParams.get('sourceLanguage')).toBe('en');return route.fulfill({json:{translations:[{id:1,targetLanguage:'ru',translation:'любовь',ai:false}]}});});
 await page.getByRole('button',{name:'Fictional song 0000',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Song details'});
 await expect(dialog.getByRole('tab',{name:'en'})).toHaveAttribute('aria-selected','true');await expect(dialog.getByRole('tab',{name:'en'}).locator('svg')).toBeVisible();
 const text=dialog.locator('.lyrics-markdown p');await text.evaluate(el=>{const range=document.createRange();range.setStart(el.firstChild!,0);range.setEnd(el.firstChild!,4);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);});await text.dispatchEvent('mouseup');
 await expect(page.getByRole('dialog',{name:'Word or phrase translation'})).toContainText('любовь');
});


test('adds phrase translations manually and asks the agent to save a phrase',async({page})=>{
 const stored:Record<string,string>={};
 await page.route('**/api/tracks/*/text',route=>route.fulfill({json:{originalLanguage:'en',texts:{en:'Love is all',ru:'',es:''}}}));
 await page.route('**/api/tracks/*/words**',route=>{const req=route.request();if(req.method()==='PUT'){const body=req.postDataJSON();stored[body.word]=body.translation;return route.fulfill({json:{ok:true}});}const url=new URL(req.url());const word=url.searchParams.get('word')!;return route.fulfill({json:{translations:stored[word]?[{id:stored[word]==='Всё — любовь'?2:1,targetLanguage:'ru',translation:stored[word],ai:stored[word]==='Всё — любовь'}]:[]}});});
 await page.route('**/api/ai/chat',route=>{const message=route.request().postDataJSON().message;expect(message).toContain('Love is all');expect(message).toContain('save_word_translations');stored['Love is all']='Всё — любовь';return route.fulfill({json:{reply:'Saved'}});});
 await page.getByRole('button',{name:'Fictional song 0000',exact:true}).click();const text=page.locator('.lyrics-markdown p');
 async function selectPhrase(){await text.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);});await text.dispatchEvent('mouseup');}
 await selectPhrase();let tip=page.getByRole('dialog',{name:'Word or phrase translation'});await expect(tip).toContainText('No saved translation');await tip.getByRole('button',{name:'Add translation'}).click();await tip.getByLabel('Translation',{exact:true}).fill('Любовь — это всё');await tip.getByRole('button',{name:'Save',exact:true}).click();await expect(tip).toContainText('Любовь — это всё');
 await page.getByTestId('lyrics-scroll').dispatchEvent('scroll');await selectPhrase();tip=page.getByRole('dialog',{name:'Word or phrase translation'});await expect(tip).toContainText('Любовь — это всё');await tip.getByRole('button',{name:'Add translation'}).click();await tip.getByRole('button',{name:'Translate with AI'}).click();await expect(tip).toContainText('Всё — любовь');await expect(tip.getByText('AI',{exact:true})).toBeVisible();
});


test('edits and confirms deletion of individual translation variants',async({page})=>{
 let translations=[{id:1,targetLanguage:'ru',translation:'любовь',ai:true},{id:2,targetLanguage:'ru',translation:'любить',ai:false}];
 await page.route('**/api/tracks/*/text',route=>route.fulfill({json:{originalLanguage:'en',texts:{en:'Love',ru:'',es:''}}}));
 await page.route('**/api/tracks/*/words**',route=>{const request=route.request();if(request.method()==='PATCH'){translations=translations.map(item=>item.id===1?{...item,translation:request.postDataJSON().translation}:item);return route.fulfill({json:{ok:true}});}if(request.method()==='DELETE'){translations=translations.filter(item=>item.id!==2);return route.fulfill({json:{ok:true}});}return route.fulfill({json:{translations}});});
 await page.getByRole('button',{name:'Fictional song 0000',exact:true}).click();const text=page.locator('.lyrics-markdown p');await text.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);});await text.dispatchEvent('mouseup');const tip=page.getByRole('dialog',{name:'Word or phrase translation'});
 await expect(tip.getByLabel('Translation',{exact:true})).toHaveCount(0);await expect(tip.getByText('AI',{exact:true})).toBeVisible();
 await tip.getByRole('button',{name:'Edit translation любовь'}).click();await tip.getByLabel('Translation',{exact:true}).fill('любовь моя');await tip.getByRole('button',{name:'Save',exact:true}).click();await expect(tip).toContainText('любовь моя');await expect(tip.getByText('AI',{exact:true})).toBeVisible();
 await tip.getByRole('button',{name:'Delete translation любить'}).click();await expect(page.getByText('Delete this translation?')).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(tip).toContainText('любить');await tip.getByRole('button',{name:'Delete translation любить'}).click();await page.getByRole('button',{name:'Delete',exact:true}).click();await expect(tip).not.toContainText('любить');await expect(tip).toContainText('любовь моя');
});

test('selects up to two populated languages, resizes text columns and scrolls metadata',async({page})=>{
 const track={id:'ready-layout',title:'Layout song',artist:'Demo Artist',album:'Demo Album',year:1968,status:'ready',file:{name:'song.flac',sizeBytes:1024,sha256:'a'.repeat(64),format:'flac',codec:'flac',sampleRate:44100,bitDepth:16,channels:2,durationSeconds:180,bitrateBps:900000}};
 await page.route('**/api/catalog?*',route=>route.fulfill({json:{generatedAt:'2026-01-01T00:00:00Z',tracks:[track],stats:{total:1,ready:1,pending:0,sizeBytes:1024},pagination:{page:1,pageSize:25,total:1,pages:1},facets:{status:['ready'],artist:['Demo Artist'],year:['1968']}}}));
 let text:{originalLanguage:string|null;texts:Record<string,string>}={originalLanguage:'en',texts:{en:'Original',ru:'Перевод',es:'Traducción'}};
 await page.route('**/api/tracks/*/text',route=>route.fulfill({json:text}));await page.reload();await page.getByRole('button',{name:'Layout song'}).click();let dialog=page.getByRole('dialog',{name:'Song details'});
 await expect(dialog.getByRole('tab',{name:'ru'})).toHaveAttribute('aria-selected','true');await expect(dialog.getByRole('tab',{name:'es'})).toHaveAttribute('aria-selected','true');await expect(dialog.getByRole('tab',{name:'en'})).toHaveAttribute('aria-selected','false');
 const left=dialog.locator('.lyrics-column').first(),right=dialog.locator('.lyrics-column').last();const before=(await left.boundingBox())!.width;const beforeRight=(await right.boundingBox())!.width;const handle=dialog.getByRole('separator',{name:'Resize ru and es texts'});const rect=(await handle.boundingBox())!;
 await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2+40,rect.y+rect.height/2,{steps:5});await page.mouse.up();expect((await left.boundingBox())!.width).toBeGreaterThan(before+25);expect((await right.boundingBox())!.width).toBeLessThan(beforeRight-25);
 const divider=dialog.getByRole('separator',{name:'Resize song information and lyrics'});await divider.focus();for(let i=0;i<15;i++)await page.keyboard.press('ArrowUp');const metadata=dialog.locator('.song-metadata');expect(await metadata.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);await metadata.evaluate(e=>e.scrollTop=100);expect(await metadata.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
 await dialog.getByRole('button',{name:'Close details'}).click();await expect(dialog).toHaveCount(0);text={originalLanguage:null,texts:{en:'',ru:'',es:''}};await page.getByRole('button',{name:'Layout song'}).click();dialog=page.getByRole('dialog',{name:'Song details'});await expect(dialog).toBeVisible();await expect(dialog.getByRole('tab',{name:'en'})).toBeVisible();await expect(dialog.getByRole('tab',{selected:true})).toHaveCount(0);await dialog.getByRole('button',{name:'Close details'}).click();await expect(dialog).toHaveCount(0);text={originalLanguage:'en',texts:{en:'',ru:'Only translation',es:''}};await page.getByRole('button',{name:'Layout song'}).click();await expect(page.getByRole('tab',{selected:true})).toHaveCount(1);await expect(page.getByRole('tab',{name:'ru'})).toHaveAttribute('aria-selected','true');
});


test('truncates long lyrics lines inside blocks without changing their height',async({page})=>{
 const long='A very long line of lyrics '.repeat(12);
 await page.route('**/api/tracks/*/text',route=>route.fulfill({json:{originalLanguage:'en',texts:{ru:'> Короткая строка\n> Ещё строка',en:`> ${long}\n> Second line`,es:''}}}));
 await page.getByRole('button',{name:'Fictional song 0000',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Song details'});const blocks=dialog.locator('.lyrics-markdown blockquote');await expect(blocks).toHaveCount(2);
 const shorter=await blocks.nth(0).boundingBox(),longer=await blocks.nth(1).boundingBox();expect(longer!.height).toBeCloseTo(shorter!.height,0);
 const line=blocks.nth(1).locator('.lyrics-line').first();await expect(line).toHaveCSS('white-space','pre');await expect(line).toHaveCSS('text-overflow','ellipsis');expect(await line.evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(true);await line.hover();const tooltip=page.getByRole('tooltip');await expect(tooltip).toHaveText(long.trim());await expect(tooltip.locator('.MuiTooltip-arrow')).toBeVisible();await page.mouse.move(5,5);await expect(tooltip).toHaveCount(0);await blocks.nth(0).locator('.lyrics-line').first().hover();await expect(page.getByRole('tooltip')).toHaveCount(0);
 await dialog.getByRole('button',{name:'Edit lyrics'}).click();await expect(dialog.getByLabel('Lyrics en')).toHaveValue(`> ${long}\n> Second line`);
});


test('uses distinct monochrome shades per language and alternates block intensity',async({page})=>{
 const text='> First line\n> Second line\n\n> Third line\n> Fourth line';
 await page.route('**/api/tracks/*/text',route=>route.fulfill({json:{originalLanguage:'en',texts:{ru:text,es:text,en:text}}}));
 await page.getByRole('button',{name:'Fictional song 0000',exact:true}).click();
 let dialog=page.getByRole('dialog',{name:'Song details'});let ru=dialog.locator('[data-language="ru"] blockquote'),es=dialog.locator('[data-language="es"] blockquote');
 await expect(ru).toHaveCount(2);await expect(es).toHaveCount(2);
 const color=async(locator:typeof ru)=>locator.evaluate(e=>getComputedStyle(e).backgroundColor);
 const lightRu=await color(ru.first()),lightEs=await color(es.first());expect(lightRu).not.toBe(lightEs);expect(await color(ru.nth(1))).not.toBe(lightRu);expect(await color(es.nth(1))).not.toBe(lightEs);
 await dialog.getByRole('tab',{name:'ru'}).click();await dialog.getByRole('tab',{name:'ru'}).click();expect(await color(ru.first())).toBe(lightRu);
 await dialog.getByRole('button',{name:'Close details'}).click();await page.getByRole('button',{name:'Open menu'}).click();await page.getByRole('button',{name:'Dark theme'}).click();await page.keyboard.press('Escape');await page.getByRole('button',{name:'Fictional song 0000',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'Song details'});ru=dialog.locator('[data-language="ru"] blockquote');es=dialog.locator('[data-language="es"] blockquote');await expect(ru).toHaveCount(2);await expect(es).toHaveCount(2);const darkRu=await color(ru.first()),darkEs=await color(es.first());expect(darkRu).not.toBe(darkEs);expect(darkRu).not.toBe(lightRu);expect(await color(ru.nth(1))).not.toBe(darkRu);
});

test('shows attempt counts and remembers visible columns',async({page})=>{
 const fixture=[{...tracks[0],attempts:6,queuedAt:'2026-01-01T12:34:56.000Z'},{...tracks[1],status:'ready',attempts:4,completedAt:'2026-01-02T12:34:56.000Z',file:{name:'x.flac',sizeBytes:1024,sha256:'a'.repeat(64),format:'flac',codec:'flac',sampleRate:44100,bitDepth:16,channels:2,durationSeconds:180,bitrateBps:900000}}];
 await page.route('**/api/catalog?*',route=>route.fulfill({json:{generatedAt:'2026-01-01T00:00:00Z',tracks:fixture,tagsByTrack:{'fixture-0':[{id:'tag-1',name:'agent-moon.dust-2'}]},stats:{total:2,ready:1,pending:1,sizeBytes:1024},pagination:{page:1,pageSize:25,total:2,pages:1},facets:{status:['pending','ready'],artist:[],year:[]}}}));await page.reload();
 const table=page.getByRole('table',{name:'Songs'});await expect(table.getByRole('columnheader',{name:'Attempts'})).toBeVisible();await expect(page.getByTestId('track-row').nth(0).getByRole('cell').nth(7)).toHaveText('6');await expect(page.getByTestId('track-row').nth(1).getByRole('cell').nth(7)).toHaveText('4');await expect(page.getByTestId('track-row').first()).toContainText('agent-moon.dust-2');
 await page.getByRole('button',{name:'Choose columns'}).click();await page.getByRole('button',{name:'Attempts',exact:true}).click();await expect(table.getByRole('columnheader',{name:'Attempts'})).toHaveCount(0);await page.keyboard.press('Escape');await page.reload();await expect(table.getByRole('columnheader',{name:'Attempts'})).toHaveCount(0);await page.getByRole('button',{name:'Choose columns'}).click();await page.getByRole('button',{name:'Attempts',exact:true}).click();await page.keyboard.press('Escape');await expect(table.getByRole('columnheader',{name:'Attempts'})).toBeVisible();
 await page.getByRole('button',{name:'Choose columns'}).click();await page.getByRole('button',{name:'Tags',exact:true}).click();await expect(table.getByRole('columnheader',{name:'Tags'})).toHaveCount(0);await page.keyboard.press('Escape');await page.reload();await expect(table.getByRole('columnheader',{name:'Tags'})).toHaveCount(0);await page.getByRole('button',{name:'Choose columns'}).click();await page.getByRole('button',{name:'Tags',exact:true}).click();await page.keyboard.press('Escape');await expect(page.getByTestId('track-row').first()).toContainText('agent-moon.dust-2');
 const first=page.getByTestId('track-row').nth(0),second=page.getByTestId('track-row').nth(1);await expect(table.getByRole('columnheader',{name:'Queued at'})).toBeVisible();await expect(table.getByRole('columnheader',{name:'Downloaded at'})).toBeVisible();await expect(first.getByRole('cell').nth(9)).not.toHaveText('—');await expect(first.getByRole('cell').nth(10)).toHaveText('—');await expect(second.getByRole('cell').nth(9)).toHaveText('—');await expect(second.getByRole('cell').nth(10)).not.toHaveText('—');
 await page.getByRole('button',{name:'Choose columns'}).click();await page.getByRole('button',{name:'Downloaded at',exact:true}).click();await page.keyboard.press('Escape');await page.reload();await expect(table.getByRole('columnheader',{name:'Downloaded at'})).toHaveCount(0);
});

test('edits persistent owner download settings',async({page})=>{
 let setting={enabled:true,maxAttempts:100,canEdit:true};
 await page.route('**/api/download/settings',route=>{if(route.request().method()==='PUT')setting={...setting,...route.request().postDataJSON()};return route.fulfill({json:setting});});
 await page.getByRole('button',{name:'Open menu'}).click();await page.getByRole('menuitem',{name:'Settings'}).click();const dialog=page.getByRole('dialog',{name:'Settings'});const toggle=dialog.getByRole('switch',{name:'Automatically stop retrying'}),limit=dialog.getByLabel('Attempt limit');await expect(toggle).toBeChecked();await expect(limit).toHaveValue('100');await toggle.uncheck();await expect(limit).toBeDisabled();await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog.getByText('Saved')).toBeVisible();await dialog.getByRole('button',{name:'Close'}).click();await page.getByRole('button',{name:'Open menu'}).click();await page.getByRole('menuitem',{name:'Settings'}).click();await expect(toggle).not.toBeChecked();await expect(limit).toBeDisabled();await toggle.check();await limit.fill('125');await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog.getByText('Saved')).toBeVisible();expect(setting).toMatchObject({enabled:true,maxAttempts:125});
});

test('reports an HTML proxy error without exposing JSON parsing errors or replaying the request',async({page})=>{
 let sent=0;await page.route('**/api/ai/settings',route=>route.fulfill({json:{model:'demo/model',hasToken:true}}));await page.route('**/api/ai/chat/history*',route=>route.fulfill({json:{turns:[],nextBefore:null}}));await page.route('**/api/ai/chat',route=>{sent++;return route.fulfill({status:504,contentType:'text/html',body:'<!DOCTYPE html><html><body>Gateway timeout</body></html>'});});
 await page.getByRole('button',{name:'AI assistant',exact:true}).click();await page.getByLabel('Message AI').fill('Find songs');await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Unexpected server response (HTTP 504)');await expect(page.getByRole('alert')).not.toContainText('Unexpected token');expect(sent).toBe(1);await expect(page.getByLabel('Message AI')).toHaveValue('');
});
