import test from 'node:test';
import assert from 'node:assert/strict';
import { historyRequestFilters, isCalendarDate } from '../src/historyFilters.js';

test('inclusive local calendar days preserve DST boundaries', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'Europe/Madrid';
  try {
    assert.deepEqual(historyRequestFilters({ kinds: ['queued'], start: '2026-03-29', end: '2026-03-29' }), {
      kinds: ['queued'], from: '2026-03-28T23:00:00.000Z', to: '2026-03-29T22:00:00.000Z',
    });
    assert.deepEqual(historyRequestFilters({ kinds: [], start: '2026-10-25', end: '2026-10-25' }), {
      from: '2026-10-24T22:00:00.000Z', to: '2026-10-25T23:00:00.000Z',
    });
    assert.equal(isCalendarDate('2026-02-30'), false);
    assert.equal(isCalendarDate('2028-02-29'), true);
    assert.equal(isCalendarDate('not-a-date'), false);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
