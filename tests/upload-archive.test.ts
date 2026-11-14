import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unpackArchive } from '../server/upload-archive.js';

test('archive entries are hashed and extracted to controlled paths',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'shelf-archive-'));
 try {
  const files=await unpackArchive('tests/fixtures/music.zip',dir);
  assert.equal(files[0].name,'Artist/Album/song.flac');
  assert.equal(files[0].sha256,createHash('sha256').update('synthetic audio').digest('hex'));
  assert.equal(readFileSync(join(dir,'entry-0'),'utf8'),'synthetic audio');
  await assert.rejects(unpackArchive('tests/fixtures/unsafe.zip',dir));
 } finally {rmSync(dir,{recursive:true,force:true});}
});
