import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CatalogStore, SnapshotConflict } from '../server/store.js';
import { catalogQuerySchema, snapshotSchema, type AudioFile, type Track } from '../shared/catalog.js';

export const exampleFile: AudioFile = { name: 'example.flac', sizeBytes: 12345678, sha256: 'a'.repeat(64), format: 'flac', codec: 'flac', sampleRate: 44100, bitDepth: 16, channels: 2, durationSeconds: 180, bitrateBps: 800000 };
export const pending: Track = { id: 'example', title: 'A fictional track', artist: 'An imaginary artist', album: 'Demo album', year: 1968, status: 'pending', file: null };
const at = (minute: number) => `2026-01-01T12:${String(minute).padStart(2, '0')}:00.000Z`;

test('completion history is idempotent, preserves source time, and survives restart', () => {
  const folder = mkdtempSync(join(tmpdir(), 'shelf-store-')); const file = join(folder, 'test.sqlite');
  let store = new CatalogStore(file);
  try {
    store.import({ generatedAt: at(0), tracks: [pending] });
    assert.equal(store.history().events.length, 1);
    assert.equal(store.history().events[0].kind, 'queued');
    const ready: Track = { ...pending, status: 'ready', file: exampleFile, completedAt: at(1) };
    const snapshot = { generatedAt: at(2), tracks: [ready] };
    assert.equal(store.import(snapshot).eventsAdded, 1);
    assert.equal(store.import(snapshot).duplicate, true);
    store.import({ ...snapshot, generatedAt: at(3) });
    assert.equal(store.history().events.length, 2);
    assert.equal(store.history().events[0].occurredAt, at(1));
    assert.equal(store.history().events[0].kind, 'downloaded');
    assert.throws(() => store.import({ generatedAt: at(0), tracks: [] }), SnapshotConflict);
    store.close(); store = new CatalogStore(file);
    assert.equal(store.catalog().stats.ready, 1);
    assert.equal(store.history().events.length, 2);
    store.import({ generatedAt: at(4), tracks: [pending] });
    store.import({ generatedAt: at(5), tracks: [ready] });
    assert.deepEqual(store.history().events.map(event => event.kind), ['restored', 'unavailable', 'downloaded', 'queued']);
    assert.equal(store.history(2).nextCursor !== null, true);
    const second = store.history(2, store.history(2).nextCursor!);
    assert.equal(second.events.length, 2);
    assert.equal(second.total, 4); assert.equal(second.events[0].kind, 'downloaded');
    assert.equal(second.nextCursor, null);
  } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('initial ready files are imported honestly and source dates can be backfilled', () => {
  const store = new CatalogStore(':memory:');
  try {
    const ready: Track = { ...pending, status: 'ready', file: exampleFile };
    store.import({ generatedAt: at(2), tracks: [ready] });
    assert.equal(store.history().events[0].kind, 'imported');
    assert.equal(store.history().events[0].timeBasis, 'import');
    store.import({ generatedAt: at(3), tracks: [{ ...ready, completedAt: at(1) }] });
    assert.equal(store.history().events.length, 1);
    assert.equal(store.history().events[0].kind, 'downloaded');
    assert.equal(store.history().events[0].occurredAt, at(1));
    store.import({ generatedAt: at(4), tracks: [{ ...ready, completedAt: at(1), file: { ...exampleFile, sha256: 'b'.repeat(64) } }] });
    assert.equal(store.history().events[0].kind, 'file_updated');
    assert.equal(store.history().events[0].occurredAt, at(4));
  } finally { store.close(); }
});

test('snapshot validation rejects private paths, inconsistent files, duplicates, and false dates', () => {
  const valid = { generatedAt: at(2), tracks: [pending] };
  assert.equal(snapshotSchema.safeParse(valid).success, true);
  assert.equal(snapshotSchema.safeParse({ ...valid, tracks: [{ ...pending, privatePath: '/private/audio' }] }).success, false);
  assert.equal(snapshotSchema.safeParse({ ...valid, tracks: [pending, pending] }).success, false);
  assert.equal(snapshotSchema.safeParse({ ...valid, tracks: [{ ...pending, status: 'ready', file: { ...exampleFile, name: '../audio.flac' } }] }).success, false);
  assert.equal(snapshotSchema.safeParse({ ...valid, tracks: [{ ...pending, file: exampleFile }] }).success, false);
  assert.equal(snapshotSchema.safeParse({ ...valid, tracks: [{ ...pending, completedAt: at(3) }] }).success, false);
  const normalized = snapshotSchema.parse({ ...valid, generatedAt: '2026-01-01T13:02:00+01:00' });
  assert.equal(normalized.generatedAt, at(2));
});

test('queue observations are deduplicated, backfilled and can precede imported completions', () => {
  const store = new CatalogStore(':memory:');
  try {
    store.import({ generatedAt: at(1), tracks: [pending] });
    store.import({ generatedAt: at(2), tracks: [pending] });
    assert.equal(store.history().total, 1);
    assert.equal(store.history().events[0].timeBasis, 'observed');
    store.import({ generatedAt: at(3), tracks: [{ ...pending, queuedAt: at(0) }] });
    assert.equal(store.history().total, 1);
    assert.equal(store.history().events[0].occurredAt, at(0));
    assert.equal(store.history().events[0].timeBasis, 'source');
    const ready: Track = { ...pending, id: 'second', status: 'ready', file: exampleFile, queuedAt: at(1), completedAt: at(2) };
    store.import({ generatedAt: at(4), tracks: [ready] });
    const history = store.history(1);
    assert.equal(history.total, 3);
    assert.equal(history.events[0].kind, 'downloaded');
    assert.equal(store.history(10, history.nextCursor!).events[0].kind, 'queued');
  } finally { store.close(); }
});

test('history filters apply before pagination and totals respect the entire interval', () => {
  const store = new CatalogStore(':memory:');
  try {
    const tracks: Track[] = Array.from({ length: 240 }, (_, index) => ({ ...pending, id: `filtered-${index}`, status: 'ready', file: exampleFile, queuedAt: index % 2 ? '2026-01-02T00:00:00.000Z' : '2026-01-01T23:59:59.999Z', completedAt: '2026-01-03T00:00:00.000Z' }));
    store.import({ generatedAt: '2026-01-04T00:00:00.000Z', tracks });
    const filters = { kinds: ['queued' as const], from: '2026-01-02T00:00:00.000Z', to: '2026-01-03T00:00:00.000Z' };
    const seen = new Set<number>();
    let cursor: string | undefined;
    do {
      const page = store.history(7, cursor, filters);
      assert.equal(page.total, 120);
      for (const event of page.events) { assert.equal(event.kind, 'queued'); assert.equal(seen.has(event.id), false); seen.add(event.id); }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert.equal(seen.size, 120);
    assert.equal(store.history(100, undefined, { ...filters, kinds: ['downloaded'] }).total, 0);
    assert.equal(store.history().total, 480);
  } finally { store.close(); }
});

test('catalog pages search, filter and sort the full library before limiting rows', () => {
  const store = new CatalogStore(':memory:');
  try {
    const tracks: Track[] = Array.from({ length: 275 }, (_, index) => ({ ...pending, id: `page-${index}`, title: `Song ${String(index).padStart(3, '0')}`, artist: index % 2 ? 'First band' : 'Second band', year: 1960 + index % 10 }));
    store.import({ generatedAt: at(0), tracks });
    const query = { page: 2, pageSize: 25, q: '', sort: 'title' as const, direction: 'desc' as const, filters: { artist: ['First band'] } };
    const result = store.catalogPage(query);
    assert.equal(result.tracks.length, 25);
    assert.equal(result.pagination?.total, 137);
    assert.equal(result.stats.total, 275);
    assert.equal(result.tracks[0].title, 'Song 223');
    assert.deepEqual(result.facets?.artist, ['First band', 'Second band']);
    const searched = store.catalogPage({ ...query, page: 1, q: 'Song 273' });
    assert.equal(searched.pagination?.total, 1);
    assert.equal(searched.tracks[0].id, 'page-273');
    const noMatch = store.catalogPage({ ...query, page: 1, filters: { artist: ['First band'], year: ['1960'] } });
    assert.equal(noMatch.pagination?.total, 0);
  } finally { store.close(); }
});

test('catalog accepts pages of 500 and 1000 but rejects larger pages',()=>{
 assert.equal(catalogQuerySchema.parse({pageSize:500}).pageSize,500);
 assert.equal(catalogQuerySchema.parse({pageSize:1000}).pageSize,1000);
 assert.equal(catalogQuerySchema.safeParse({pageSize:1001}).success,false);
});

test('attempt counts survive catalog snapshots for ready and pending tracks and sort numerically',()=>{
 const store=new CatalogStore(':memory:');try{
  const snapshot=snapshotSchema.parse({generatedAt:at(1),tracks:[{...pending,id:'ready',status:'ready',file:exampleFile,attempts:4},{...pending,id:'pending',attempts:101},{...pending,id:'legacy'}]});store.import(snapshot);
  const page=store.catalogPage({page:1,pageSize:25,q:'',sort:'attempts',direction:'desc',filters:{}});assert.deepEqual(page.tracks.map(track=>[track.id,track.attempts]),[['pending',101],['ready',4],['legacy',undefined]]);assert.throws(()=>snapshotSchema.parse({generatedAt:at(1),tracks:[{...pending,attempts:-1}]}));
 }finally{store.close();}
});

test('queue and completion dates sort across the catalog with unknown dates last',()=>{
 const store=new CatalogStore(':memory:');try{
  store.import({generatedAt:at(4),tracks:[{...pending,id:'old',queuedAt:at(0),status:'ready',file:exampleFile,completedAt:at(2)},{...pending,id:'new',queuedAt:at(1),status:'ready',file:exampleFile,completedAt:at(3)},{...pending,id:'unknown'}]});
  for(const sort of ['queuedAt','completedAt'] as const){
   const base={page:1,pageSize:2,q:'',sort,filters:{}};
   assert.deepEqual(store.catalogPage({...base,direction:'asc'}).tracks.map(track=>track.id),['old','new']);
   assert.deepEqual(store.catalogPage({...base,direction:'desc'}).tracks.map(track=>track.id),['new','old']);
   assert.deepEqual(store.catalogPage({...base,page:2,direction:'desc'}).tracks.map(track=>track.id),['unknown']);
  }
 }finally{store.close();}
});
