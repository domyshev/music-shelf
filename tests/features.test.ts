import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Features } from '../server/features.js';
import { CatalogStore } from '../server/store.js';

test('song texts survive snapshots and tokens are encrypted and isolated by account', async () => {
  const dir=mkdtempSync(join(tmpdir(),'shelf-features-')); const path=join(dir,'db.sqlite');
  const store=new CatalogStore(path); const secret=Buffer.alloc(32,1); let authorization='';
  const transport:typeof fetch=async (url,init)=>{if(String(url).endsWith('/models')) return Response.json({data:[{id:'a/b',name:'A'}]}); authorization=String((init?.headers as Record<string,string>).Authorization);return Response.json({choices:[{message:{content:'Hello'}}]});};
  let features=new Features(path,secret,transport);
  try {
    const track={id:'track1',title:'Song',artist:'Artist',album:'',year:null,status:'pending' as const,file:null};
    store.import({generatedAt:'2026-01-01T00:00:00.000Z',tracks:[track]});
    assert.equal(features.saveLyrics('missing','one@example.com','x','y'),false);
    assert.equal(features.saveLyrics('track1','one@example.com','lyrics','translation'),true);
    store.import({generatedAt:'2026-01-02T00:00:00.000Z',tracks:[track]});
    assert.deepEqual({...features.lyrics('track1','one@example.com')},{lyrics:'lyrics',translation:'translation'});
    features.saveSettings('one@example.com','a/b','secret-token');
    assert.deepEqual(features.settings('one@example.com'),{model:'a/b',hasToken:true});
    assert.deepEqual(features.settings('two@example.com'),{model:'',hasToken:false});
    assert.equal(await features.chat('two@example.com',[{role:'user',content:'Hi'}]),null);
    assert.equal(await features.chat('one@example.com',[{role:'user',content:'Hi'}]),'Hello');
    assert.equal(authorization,'Bearer secret-token');
    features.close(); store.close();
    assert.equal(readFileSync(path).includes(Buffer.from('secret-token')),false);
    features=new Features(path,secret,transport);
    assert.equal(await features.chat('one@example.com',[{role:'user',content:'Hi'}]),'Hello');
    features.saveSettings('one@example.com','a/b',undefined,true);
    assert.equal(features.settings('one@example.com').hasToken,false);
  } finally {features.close();try{store.close();}catch{}rmSync(dir,{recursive:true,force:true});}
});
