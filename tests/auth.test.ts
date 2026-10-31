import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { AuthError, EmailAuth, resendMailer } from '../server/auth.js';
import { CatalogStore } from '../server/store.js';
import { createApp } from '../server/http.js';

test('one-time codes expire, enforce attempts and cooldowns, and persist sessions across restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'shelf-auth-')); const path = join(directory, 'auth.sqlite');
  let clock = Date.now(); const secret = Buffer.alloc(32, 1); let auth = new EmailAuth(path, secret, () => clock);
  try {
    const challenge = auth.issue('test@example.invalid', 'test-client'); auth.delivered(challenge.challengeId);
    assert.throws(() => auth.issue('test@example.invalid', 'test-client'), (error: unknown) => error instanceof AuthError && error.status === 429);
    const wrong = challenge.code === '000000' ? '999999' : '000000';
    for (let attempt = 0; attempt < 5; attempt++) assert.throws(() => auth.verify(challenge.challengeId, wrong), AuthError);
    assert.throws(() => auth.verify(challenge.challengeId, challenge.code), AuthError);
    clock += 61000;
    const second = auth.issue('test@example.invalid', 'test-client'); auth.delivered(second.challengeId);
    const session = auth.verify(second.challengeId, second.code);
    assert.throws(() => auth.verify(second.challengeId, second.code), AuthError);
    auth.close(); auth = new EmailAuth(path, secret, () => clock);
    assert.equal(auth.session(session.token), 'test@example.invalid');
    auth.logout(session.token); assert.equal(auth.session(session.token), undefined);
    clock += 61000;
    const third = auth.issue('test@example.invalid', 'test-client'); auth.delivered(third.challengeId);
    clock += 600001; assert.throws(() => auth.verify(third.challengeId, third.code), AuthError);
    const failed = auth.issue('delivery-failed@example.invalid', 'test-client'); auth.deliveryFailed(failed.challengeId);
    assert.throws(() => auth.verify(failed.challengeId, failed.code), AuthError);
  } finally { auth.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('email sign-in enforces Origin, issues a secure cookie, rejects legacy codes and revokes logout', async () => {
  const store = new CatalogStore(':memory:'); const auth = new EmailAuth(':memory:', Buffer.alloc(32, 2));
  let sent = { code: '', id: '' };
  const app = createApp({ store, auth, origin: 'https://shelf.example.invalid', secureCookies: true, mailer: { async send(_email, code, id) { sent = { code, id }; } }, clientDirectory: '/nonexistent' });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, origin = 'https://shelf.example.invalid', cookie = '') => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(base + '/api/catalog', { headers: { 'X-Access-Code': 'old-shared-code' } })).status, 401);
    assert.equal((await post('/api/auth/request-code', { email: 'test@example.invalid' }, 'https://evil.invalid')).status, 403);
    assert.equal((await post('/api/auth/request-code', { email: 'invalid' })).status, 400);
    const response = await post('/api/auth/request-code', { email: 'Test@Example.invalid' });
    assert.equal(response.status, 200);
    const issued = await response.json() as { challengeId: string; code?: string };
    assert.equal(issued.code, undefined); assert.equal(issued.challengeId, sent.id);
    const verified = await post('/api/auth/verify-code', { challengeId: sent.id, code: sent.code });
    assert.equal(verified.status, 200);
    const setCookie = verified.headers.get('set-cookie')!;
    assert.match(setCookie, /__Host-music-shelf-session=/); assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=Lax/);
    const cookie = setCookie.split(';')[0];
    assert.equal((await fetch(base + '/api/catalog', { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await post('/api/auth/verify-code', { challengeId: sent.id, code: sent.code })).status, 400);
    assert.equal((await post('/api/auth/logout', {}, 'https://evil.invalid', cookie)).status, 403);
    assert.equal((await post('/api/auth/logout', {}, undefined, cookie)).status, 200);
    assert.equal((await fetch(base + '/api/session', { headers: { Cookie: cookie } })).status, 401);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); auth.close(); }
});

test('Resend transport uses a unique idempotency key and never exposes provider errors', async () => {
  const calls: RequestInit[] = [];
  const transport = (async (_url: unknown, init: RequestInit) => { calls.push(init); return new Response('{}', { status: 200 }); }) as typeof fetch;
  await resendMailer('fake-test-key', 'Test <sender@example.invalid>', transport).send('test@example.invalid', '123456', 'test-challenge');
  assert.equal((calls[0].headers as Record<string, string>)['Idempotency-Key'], 'music-shelf-login/test-challenge');
  assert.equal(JSON.parse(calls[0].body as string).to[0], 'test@example.invalid');
  const failing = (async () => new Response('sensitive provider response', { status: 403 })) as typeof fetch;
  await assert.rejects(() => resendMailer('fake-test-key', 'test@example.invalid', failing).send('test@example.invalid', '123456', 'id'), /^Error: Email delivery failed$/);
});
