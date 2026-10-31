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
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Access code' }).fill('test-only-ui-code');
  await page.getByRole('button', { name: 'Open library' }).click();
  await expect(page.getByRole('table', { name: 'Songs', exact: true })).toBeVisible();
});
test('virtualizes a large library, scrolls the table only, searches, sorts and retains login', async ({ page }) => {
  expect(await page.getByTestId('track-row').count()).toBeLessThan(100);
  const scroll = page.getByTestId('library-scroll');
  await scroll.hover(); await page.mouse.wheel(0, 500000);
  await expect(page.getByRole('button', { name: 'Fictional song 0099', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole('button', { name: 'Go to next page' }).click();
  await expect(page.getByRole('button', { name: 'Fictional song 0100', exact: true })).toBeVisible();
  await page.getByPlaceholder('Search songs, artists and albums').fill('Fictional song 0123');
  await expect(page.getByTestId('track-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.getByRole('button', { name: 'Song', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Song' })).toHaveAttribute('aria-sort', 'ascending');
  await page.reload();
  await expect(page.getByRole('table', { name: 'Songs', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Access code' })).toHaveCount(0);
});
test('opens newest-first history and keeps logout inside the menu', async ({ page }) => {
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Download history' }).click();
  await expect(page.getByRole('table', { name: 'Download history', exact: true })).toBeVisible();
  await expect(page.getByTestId('history-row').first()).toContainText('Newer fictional song');
  await page.getByRole('button', { name: 'Close history' }).click();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('textbox', { name: 'Access code' })).toBeVisible();
});
test('fits a phone viewport without document scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const documentFits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight);
  expect(documentFits).toBe(true);
  await expect(page.getByTestId('library-scroll')).toBeVisible();
});
