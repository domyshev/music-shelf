import { createHash, createPublicKey } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createApp } from './http.js';
import { CatalogStore } from './store.js';

process.umask(0o077);
if (existsSync('.env')) process.loadEnvFile('.env');
const rawCode = process.env.SHELF_ACCESS_CODE;
const hashFile = process.env.SHELF_ACCESS_HASH_FILE;
if ((!rawCode && !hashFile) || (rawCode && hashFile)) throw new Error('Configure exactly one of SHELF_ACCESS_CODE or SHELF_ACCESS_HASH_FILE');
const hash = hashFile ? readFileSync(hashFile, 'utf8').trim() : createHash('sha256').update(rawCode!).digest('hex');
if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Access verifier must be a SHA-256 hexadecimal digest');
const database = resolve(process.env.SHELF_DB_PATH ?? 'data/library.sqlite');
mkdirSync(dirname(database), { recursive: true, mode: 0o700 });
const store = new CatalogStore(database);
const keyFile = process.env.SHELF_PUBLISHER_PUBLIC_KEY_FILE;
const publisherKey = keyFile ? createPublicKey(readFileSync(keyFile)) : undefined;
if (publisherKey && publisherKey.asymmetricKeyType !== 'ed25519') throw new Error('Publisher key must use Ed25519');
const port = Number(process.env.PORT ?? 4174);
const host = process.env.HOST ?? '127.0.0.1';
const server = createApp({ demo: process.env.SHELF_DEMO_MODE === '1', store, accessHash: Buffer.from(hash, 'hex'), publisherKey }).listen(port, host, () => console.log(`Music Shelf listening on ${host}:${port}`));
function stop() { server.close(() => { store.close(); process.exit(0); }); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
