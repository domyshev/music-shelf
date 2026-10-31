import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/http.js';
import { EmailAuth } from '../server/auth.js';
import { CatalogStore } from '../server/store.js';

const pending = { id: 'demo', title: 'Synthetic title', artist: 'Demo artist', album: '', year: 1968, status: 'pending', file: null };
test('HTTP authentication, signed imports, replay handling and cursor validation', async () => {
  const store = new CatalogStore(':memory:'); const keys = generateKeyPairSync('ed25519');
  const clock = Date.now(); const timestamp = String(Math.floor(clock / 1000));
  const auth = new EmailAuth(':memory:', Buffer.alloc(32, 3));
  const challenge = auth.issue('test@example.invalid', 'test'); auth.delivered(challenge.challengeId); const session = auth.verify(challenge.challengeId, challenge.code);
  const app = createApp({ store, auth, mailer: { async send() {} }, origin: 'http://test.invalid', publisherKey: keys.publicKey, now: () => clock, clientDirectory: '/nonexistent-test-client' });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { Cookie: 'music-shelf-session=' + session.token };
  const signed = (payload: unknown, bodyTimestamp = timestamp) => {
    const body = JSON.stringify(payload);
    return { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Shelf-Timestamp': bodyTimestamp, 'X-Shelf-Signature': sign(null, Buffer.from(bodyTimestamp + '\n' + body), keys.privateKey).toString('base64') } };
  };
  try {
    assert.equal((await fetch(base + '/api/catalog')).status, 401);
    assert.equal((await fetch(base + '/api/session', { headers })).status, 200);
    assert.equal((await fetch(base + '/api/history?limit=abc', { headers })).status, 400);
    assert.equal((await fetch(base + '/api/history?cursor=not-a-cursor', { headers })).status, 400);
    assert.equal((await fetch(base + '/audio/example.flac')).status, 404);
    const snapshot = { generatedAt: new Date(clock - 10000).toISOString(), tracks: [pending] };
    const valid = signed(snapshot);
    assert.equal((await fetch(base + '/api/import', { ...valid, body: valid.body + ' ' })).status, 403);
    assert.equal((await fetch(base + '/api/import', valid)).status, 200);
    const repeated = await (await fetch(base + '/api/import', valid)).json() as { duplicate: boolean };
    assert.equal(repeated.duplicate, true);
    assert.equal((await fetch(base + '/api/import', signed({ ...snapshot, generatedAt: new Date(clock - 20000).toISOString() }))).status, 409);
    assert.equal((await fetch(base + '/api/import', signed({ ...snapshot, tracks: [{ ...pending, internalUrl: 'http://private.invalid' }] }))).status, 400);
    assert.equal((await fetch(base + '/api/import', signed(snapshot, String(Number(timestamp) - 600)))).status, 400);
    const catalog = await (await fetch(base + '/api/catalog', { headers })).json() as { stats: { total: number } };
    assert.equal(catalog.stats.total, 1);
    assert.equal((await fetch(base + '/api/catalog?pageSize=9999', { headers })).status, 400);
    assert.equal((await fetch(base + '/api/catalog?sort=payload', { headers })).status, 400);
    assert.equal((await fetch(base + '/api/catalog?filters=broken', { headers })).status, 400);
    const filtered = await (await fetch(base + '/api/history?kind=queued&from=' + encodeURIComponent(snapshot.generatedAt), { headers })).json() as { total: number; events: { kind: string }[] };
    assert.equal(filtered.total, 1); assert.equal(filtered.events[0].kind, 'queued');
    assert.equal((await fetch(base + '/api/history?kind=unknown', { headers })).status, 400);
    assert.equal((await fetch(base + '/api/history?from=2026-02-30', { headers })).status, 400);
    assert.equal((await fetch(base + '/api/history?from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z', { headers })).status, 400);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); auth.close(); }
});
