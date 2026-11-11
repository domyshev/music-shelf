import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Tags } from '../server/tags.js';

test('selections retain pending tracks and context, isolate users and reject duplicate associations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'music-shelf-tags-'));
  const path = join(dir, 'database.sqlite');
  const tags = new Tags(path);
  try {
    const tag = tags.create('one@example.test', 'moon.dust', 'Explore blues', {library: ['existing']}, ['pending', 'ready']);
    assert.equal(tag.name, 'agent-moon.dust-2');
    assert.deepEqual(tag.trackIds, ['pending', 'ready']);
    assert.deepEqual(tag.basis, {library: ['existing']});
    const pageIds = Array.from({length: 1000}, (_, index) => index === 999 ? 'pending' : `track-${index}`);
    assert.deepEqual(tags.forTracks('one@example.test', pageIds).pending, [{id:tag.id,name:tag.name}]);
    assert.equal(tags.get('other@example.test', tag.id), null);
    assert.deepEqual(tags.list('other@example.test'), []);
    assert.throws(() => tags.create('one@example.test', 'moon.dust', 'Duplicate', {}, ['pending']));
    assert.throws(() => tags.create('one@example.test', 'bad-name', 'Invalid', {}, ['pending']));
    assert.throws(() => tags.create('one@example.test', 'long.enough', 'Duplicate tracks', {}, ['x', 'x']));
    tags.close();
    const reopened = new Tags(path);
    try { assert.deepEqual(reopened.get('one@example.test', tag.id)?.trackIds, ['pending', 'ready']); }
    finally { reopened.close(); }
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
