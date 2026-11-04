import { test, expect } from '@playwright/test';
const tracks = Array.from({ length: 5000 }, (_, index) => ({ id: `fixture-${index}`, title: `Fictional song ${String(index).padStart(4, '0')}`, artist: `Demo Artist ${index % 7}`, album: 'Synthetic album', year: 1960 + index % 10, status: 'pending', file: null }));
test.beforeEach(async ({ page }) => {
  await page.route('**/api/catalog?*', route => {
    const params = new URL(route.request().url()).searchParams;
    const query = (params.get('q') ?? '').toLowerCase();
    const matching = tracks.filter(track => `${track.title} ${track.artist}`.toLowerCase().includes(query));
    if (params.get('sort') === 'title') matching.sort((a, b) => a.title.localeCompare(b.title) * (params.get('direction') === 'desc' ? -1 : 1));
    const page = Number(params.get('page') ?? 1); const pageSize = Number(params.get('pageSize') ?? 100);
    return route.fulfill({ json: { generatedAt: '2026-01-01T12:00:00.000Z', tracks: matching.slice((page - 1) * pageSize, page * pageSize), stats: { total: 5000, ready: 0, pending: 5000, sizeBytes: 0 }, pagination: { page, pageSize, total: matching.length, pages: Math.ceil(matching.length / pageSize) }, facets: { status: ['pending'], artist: [...new Set(tracks.map(track => track.artist))], year: ['1960'] } } });
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
  await page.getByRole('button',{name:'Edit',exact:true}).click();await expect(page.getByLabel('Lyrics en',{exact:true})).toHaveValue('Some lyrics');
  await page.getByRole('tab',{name:'ru',exact:true}).click();await expect(page.getByLabel('Lyrics ru',{exact:true})).toHaveValue('Some translation');
  await page.getByRole('button',{name:'Add language'}).click();await page.getByLabel('Language code').fill('fr');await page.getByRole('button',{name:'Add',exact:true}).click();
  await page.getByRole('combobox',{name:'Original language'}).click();await page.getByRole('option',{name:'French',exact:true}).click();
  await page.getByLabel('Lyrics fr',{exact:true}).fill('Paroles');await page.getByRole('button',{name:'Save lyrics'}).click();await expect(page.getByText('Saved',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close details'}).click();await page.getByRole('button',{name:'Fictional song 0000',exact:true}).click();await expect(page.getByRole('combobox',{name:'Original language'})).toHaveText('fr');await expect(page.getByText('Paroles',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Close details'}).click();
  await page.getByRole('button',{name:'AI assistant',exact:true}).click();
  await page.getByRole('button',{name:'Agent menu'}).click();await page.getByRole('menuitem',{name:'Agent settings'}).click();
  await page.getByLabel('OpenRouter API token').fill('sample-key');
  await page.getByRole('combobox',{name:'OpenRouter model'}).click();await page.getByRole('option',{name:'Demo model (demo/model)'}).click();
  await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByText('Settings saved')).toBeVisible();
  const token=page.getByLabel('Replace API token');await expect(token).toHaveAttribute('type','password');await expect(token).toHaveAttribute('placeholder','●●●●●●●●●●●●');await expect(token).toHaveValue('');await expect(page.getByRole('button',{name:'Remove token'})).toBeVisible();await page.screenshot({path:'/tmp/music-shelf-settings-026.png'});await page.getByRole('button',{name:'Remove token'}).click();await expect(page.getByLabel('OpenRouter API token')).toBeVisible();await page.getByLabel('OpenRouter API token').fill('replacement-key');await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByLabel('Replace API token')).toHaveAttribute('placeholder','●●●●●●●●●●●●');
  await page.getByRole('button',{name:'Back to chat'}).click();await page.getByLabel('Message AI').fill('Hello');await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByText('A demo reply')).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'AI assistant',exact:true}).click();await expect(page.getByText('Hello',{exact:true})).toBeVisible();await expect(page.getByText('A demo reply')).toBeVisible();
});

test('uses the turntable mark and blue-red themes', async ({ page }) => {
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href','/music-shelf.svg');
  const icon=page.locator('.app-header .wordmark-icon');await expect(icon).toBeVisible();
  expect(await icon.evaluate((image: HTMLImageElement)=>image.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Open menu'}).click();await page.getByRole('button',{name:'Light theme'}).click();await page.keyboard.press('Escape');
  await expect(page.locator('.app-shell')).toHaveCSS('background-color','rgb(243, 246, 252)');
  await page.screenshot({path:'/tmp/music-shelf-light-024.png'});
  await page.getByRole('button',{name:'Open menu'}).click();await page.getByRole('button',{name:'Dark theme'}).click();await page.keyboard.press('Escape');
  await expect(page.locator('.app-shell')).toHaveCSS('background-color','rgb(16, 23, 38)');
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
 await dialog.getByRole('tab',{name:'ru',exact:true}).click();await dialog.getByRole('button',{name:'Edit',exact:true}).click();await expect(dialog.getByLabel('Lyrics en')).toBeVisible();await expect(dialog.getByLabel('Lyrics ru')).toBeVisible();await page.screenshot({path:'/tmp/music-shelf-song-026.png'});
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
 await page.reload();await page.getByRole('button',{name:'A real-shaped song'}).click();const dialog=page.getByRole('dialog',{name:'Song details'});await dialog.getByRole('tab',{name:'ru',exact:true}).click();
 const scroll=dialog.getByTestId('lyrics-scroll');await expect(scroll).toBeVisible();expect(await scroll.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
 const file=dialog.getByText('song.flac',{exact:true});await expect(file).toBeVisible();const before=await file.boundingBox();await scroll.evaluate(e=>e.scrollTop=500);expect((await file.boundingBox())!.y).toBe(before!.y);await expect(dialog.getByRole('button',{name:'Save lyrics'})).toBeVisible();
 await page.screenshot({path:'/tmp/music-shelf-ready-026.png'});
 await page.setViewportSize({width:390,height:844});await expect(dialog.locator('.lyrics-markdown').first()).toBeVisible();await expect(dialog.getByRole('button',{name:'Save lyrics'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


test('renders song Markdown blocks and resizes metadata independently', async ({page}) => {
 await page.route('**/api/tracks/*/text',route=>route.fulfill({json:{originalLanguage:'fr',texts:{fr:'> Premier vers\n> Deuxième vers\n\nPlain text',ru:'> Первая строка\n> Вторая строка',en:'',es:''}}}));
 await page.getByRole('button',{name:'Fictional song 0000',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Song details'});
 await expect(dialog.getByRole('combobox',{name:'Original language'})).toHaveText('fr');
 await expect(dialog.getByRole('tab')).toHaveText(['ru','es','en','fr']);
 await dialog.getByRole('combobox',{name:'Original language'}).click();
 const options=page.getByRole('option');await expect(options.nth(0)).toHaveText('Russian');await expect(options.nth(1)).toHaveText('Spanish');await expect(options.nth(2)).toHaveText('English');await expect(options.filter({hasText:'Russian'})).toHaveCount(1);await page.keyboard.press('Escape');
 await expect(dialog.locator('.lyrics-markdown blockquote')).toContainText('Premier vers');
 await dialog.getByRole('tab',{name:'ru',exact:true}).click();
 await expect(dialog.locator('.lyrics-markdown blockquote')).toHaveCount(2);await expect(dialog.locator('.lyrics-column-heading')).toHaveCount(0);
 await expect(dialog.locator('.lyrics-column').first()).toContainText('Первая строка');await expect(dialog.locator('.lyrics-column').last()).toContainText('Premier vers');
 const metadata=dialog.locator('.song-metadata');const before=(await metadata.boundingBox())!.height;
 const divider=dialog.getByRole('separator',{name:'Resize song information and lyrics'});const rect=(await divider.boundingBox())!;
 await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2+70,{steps:5});await page.mouse.up();
 expect((await metadata.boundingBox())!.height).toBeGreaterThan(before+50);
 await divider.focus();await page.keyboard.press('ArrowUp');const savedHeight=(await metadata.boundingBox())!.height;expect(savedHeight).toBeLessThan(before+60);
 await dialog.getByRole('button',{name:'Close details'}).click();await page.getByRole('button',{name:'Fictional song 0001',exact:true}).click();await expect(page.locator('.song-metadata')).toHaveCSS('height',`${savedHeight}px`);await page.reload();await page.getByRole('button',{name:'Fictional song 0000',exact:true}).click();await expect(page.locator('.song-metadata')).toHaveCSS('height',`${savedHeight}px`);
});
