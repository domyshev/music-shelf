/** Generate an isolated demonstration database with fictional metadata only. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CatalogStore } from '../server/store.js';
import type { Snapshot, Track } from '../shared/catalog.js';

const database = resolve(process.env.SHELF_DEMO_DB ?? 'local/demo.sqlite');
if (existsSync(database)) { console.error('Demo database already exists; choose a new SHELF_DEMO_DB path.'); process.exit(1); }
mkdirSync(dirname(database), { recursive: true, mode: 0o700 });
const count = Math.min(10000, Math.max(1, Number(process.env.SHELF_DEMO_COUNT ?? 3000)));
const now = Date.now();
const titles = ['Amber Windows', 'Quiet Harbour', 'Paper Moons', 'The Sunday Tram', 'A Different Morning', 'Soft Geometry', 'Under the Cedar', 'Night Orchard', 'Slow Satellites', 'The Last Postcard'];
const artists = ['Harbor Ensemble', 'The Green Rooms', 'June Arcade', 'Mira & The Lanterns', 'Northbound Quartet', 'Field Notes', 'The Paper Kites Club', 'Summer Atlas'];
const tracks: Track[] = Array.from({ length: count }, (_, index) => {
  const ready = index % 4 !== 0;
  return { id: `synthetic-${index + 1}`, title: `${titles[index % titles.length]} ${String(index + 1).padStart(4, '0')}`, artist: artists[index % artists.length], album: `Fictional Sessions ${Math.floor(index / 20) + 1}`, year: 1960 + index % 10, status: ready ? 'ready' : 'pending', queuedAt: new Date(now - (count - index) * 60000 - 120000).toISOString(), completedAt: ready ? new Date(now - (count - index) * 60000).toISOString() : null,
    file: ready ? { name: `synthetic-${index + 1}.flac`, sizeBytes: 12000000 + index * 14327, sha256: createHash('sha256').update(`fictional-file-${index}`).digest('hex'), format: 'flac', codec: 'flac', sampleRate: index % 5 === 0 ? 96000 : 44100, bitDepth: index % 5 === 0 ? 24 : 16, channels: 2, durationSeconds: 160 + index % 180, bitrateBps: 850000 } : null };
});
const store = new CatalogStore(database);
const snapshot: Snapshot = { generatedAt: new Date(now).toISOString(), tracks };
store.import(snapshot); store.close();
console.log(`Created ${count} fictional tracks in the isolated demo database. No audio files exist.`);
console.log('Start with SHELF_DB_PATH pointing to this database, SHELF_DEMO_MODE=1 and your own SHELF_ACCESS_CODE.');
