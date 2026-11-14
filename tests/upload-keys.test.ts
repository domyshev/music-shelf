import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UploadKeys } from '../server/upload-keys.js';

test('upload keys are scoped, revocable and never persisted in plaintext', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shelf-upload-keys-'));
  const path = join(dir, 'test.sqlite');
  try {
    const keys = new UploadKeys(path);
    const key = keys.create('alice@example.test', 'Agent');
    assert.match(key.token, /^msu_[A-Za-z0-9_-]{43}$/);
    assert.equal(keys.authenticate(key.token)?.id, key.id);
    assert.equal(keys.authenticate(key.token)?.owner, 'alice@example.test');
    assert.equal(keys.authenticate(key.token + 'x'), undefined);
    assert.equal(keys.list('bob@example.test').length, 0);
    assert.equal(JSON.stringify(keys.list('alice@example.test')).includes(key.token), false);
    assert.equal(keys.revoke('bob@example.test', key.id), false);
    assert.ok(keys.authenticate(key.token));
    assert.equal(keys.revoke('alice@example.test', key.id), true);
    assert.equal(keys.authenticate(key.token), undefined);
    assert.equal(keys.revoke('alice@example.test', key.id), false);
    assert.throws(() => keys.create('alice@example.test', ' \n'));
    keys.close();
    assert.equal(readFileSync(path).includes(Buffer.from(key.token)), false);
    const reopened = new UploadKeys(path);
    assert.equal(reopened.authenticate(key.token), undefined);
    assert.equal(reopened.list('alice@example.test').length, 1);
    reopened.close();
  } finally { rmSync(dir, {recursive:true, force:true}); }
});
