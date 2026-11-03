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
    if (route.request().method()==='PUT') {text=route.request().postDataJSON();await route.fulfill({json:{ok:true}});} else await route.fulfill({json:text});
  });
  await page.route('**/api/ai/settings', route => route.fulfill({json:{model:'demo/model',hasToken:route.request().method()==='PUT'}}));
  await page.route('**/api/ai/models', route => route.fulfill({json:{models:[{id:'demo/model',name:'Demo model',supportsTools:true}]}}));
  const turns:{id:number;requestId:string;message:string;reply:string;state:string;createdAt:string}[]=[];
  await page.route('**/api/ai/chat/history*', route => route.fulfill({json:{turns,nextBefore:null}}));
  await page.route('**/api/ai/chat', route => {const body=route.request().postDataJSON();turns.push({id:turns.length+1,requestId:body.requestId,message:body.message,reply:'A demo reply',state:'complete',createdAt:'2026-01-01T00:00:00Z'});return route.fulfill({json:{reply:'A demo reply'}});});
  await page.getByRole('button', {name:'Fictional song 0000',exact:true}).click();
  await page.getByLabel('Lyrics · en · original',{exact:true}).fill('Some lyrics');
  await page.getByRole('tab',{name:'ru',exact:true}).click();
  await page.getByLabel('Lyrics · ru',{exact:true}).fill('Some translation');
  await page.getByRole('button',{name:'Save lyrics'}).click();
  await expect(page.getByText('Saved',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close details'}).click();
  await page.getByRole('button', {name:'Fictional song 0000',exact:true}).click();
  await expect(page.getByLabel('Lyrics · en · original',{exact:true})).toHaveValue('Some lyrics');
  await page.getByRole('tab',{name:'ru',exact:true}).click();await expect(page.getByLabel('Lyrics · ru',{exact:true})).toHaveValue('Some translation');
  await page.getByLabel('Language code').fill('fr');await page.getByRole('button',{name:'Add language'}).click();await page.getByRole('button',{name:'Mark fr as original'}).click();await page.getByLabel('Lyrics · fr · original').fill('Paroles');await page.getByRole('button',{name:'Save lyrics'}).click();await expect(page.getByText('Saved',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close details'}).click();
  await page.getByRole('button',{name:'Open menu'}).click();await page.getByRole('menuitem',{name:'AI assistant'}).click();
  await page.getByRole('button',{name:'AI settings'}).click();
  await page.getByLabel('OpenRouter API token').fill('sample-key');
  await page.getByRole('combobox',{name:'OpenRouter model'}).click();await page.getByRole('option',{name:'Demo model (demo/model)'}).click();
  await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByText('Settings saved')).toBeVisible();
  await page.getByRole('button',{name:'Back to chat'}).click();await page.getByLabel('Message AI').fill('Hello');await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByText('A demo reply')).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'Open menu'}).click();await page.getByRole('menuitem',{name:'AI assistant'}).click();await expect(page.getByText('Hello',{exact:true})).toBeVisible();await expect(page.getByText('A demo reply')).toBeVisible();
});
