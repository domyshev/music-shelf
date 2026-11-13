import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Features } from '../server/features.js';
import { DatabaseSync } from 'node:sqlite';
import { CatalogStore } from '../server/store.js';

test('song texts survive snapshots and tokens are encrypted and isolated by account', async () => {
  const dir=mkdtempSync(join(tmpdir(),'shelf-features-')); const path=join(dir,'db.sqlite');
  const store=new CatalogStore(path); const secret=Buffer.alloc(32,1); let authorization='';
  const transport:typeof fetch=async (url,init)=>{if(String(url).endsWith('/models')) return Response.json({data:[{id:'a/b',name:'A'}]}); authorization=String((init?.headers as Record<string,string>).Authorization);return Response.json({choices:[{message:{content:'Hello'}}]});};
  let features=new Features(path,secret,transport);
  try {
    const track={id:'track1',title:'Song',artist:'Artist',album:'',year:null,status:'pending' as const,file:null};
    store.import({generatedAt:'2026-01-01T00:00:00.000Z',tracks:[track]});
    assert.equal(features.lyrics('track1','one@example.com')?.originalLanguage,null);
    assert.equal(features.saveLyrics('track1','two@example.com','und',{ru:'translation'}),true);
    assert.equal(features.lyrics('track1','two@example.com')?.originalLanguage,null);
    assert.equal(features.saveLyrics('missing','one@example.com','en',{en:'x',ru:'y'}),false);
    assert.equal(features.saveLyrics('track1','one@example.com','fr',{fr:'lyrics',ru:'translation'}),true);
    store.import({generatedAt:'2026-01-02T00:00:00.000Z',tracks:[track]});
    assert.deepEqual({...features.lyrics('track1','one@example.com')},{originalLanguage:'fr',texts:{fr:'lyrics',ru:'translation'}});
    features.saveSettings('one@example.com','a/b','secret-token');
    assert.deepEqual(features.settings('one@example.com'),{model:'a/b',translationModel:'a/b',hasToken:true});
    assert.deepEqual(features.settings('two@example.com'),{model:'',translationModel:'',hasToken:false});
    assert.equal(await features.chat('two@example.com',[{role:'user',content:'Hi'}],store),null);
    assert.equal(await features.chat('one@example.com',[{role:'user',content:'Hi'}],store),'Hello');
    assert.equal(authorization,'Bearer secret-token');
    features.close(); store.close();
    assert.equal(readFileSync(path).includes(Buffer.from('secret-token')),false);
    features=new Features(path,secret,transport);
    assert.equal(await features.chat('one@example.com',[{role:'user',content:'Hi'}],store),'Hello');
    features.saveSettings('one@example.com','a/b',undefined,true);
    assert.equal(features.settings('one@example.com').hasToken,false);
  } finally {features.close();try{store.close();}catch{}rmSync(dir,{recursive:true,force:true});}
});

test('legacy lyrics and unknown-language translation remain available', () => {
  const dir=mkdtempSync(join(tmpdir(),'shelf-legacy-'));const path=join(dir,'db.sqlite');const store=new CatalogStore(path);const secret=Buffer.alloc(32,7);const features=new Features(path,secret);
  try {
    store.import({generatedAt:'2026-01-01T00:00:00.000Z',tracks:[{id:'old',title:'Old',artist:'Artist',album:'',year:null,status:'pending',file:null}]});
    const db=new DatabaseSync(path);db.prepare('INSERT INTO track_texts VALUES(?,?,?,?,?)').run('old','test@example.invalid','Old lyrics','Old translation','2026-01-01');db.close();
    assert.deepEqual(features.lyrics('old','test@example.invalid'),{originalLanguage:'en',texts:{en:'Old lyrics',ru:'',es:'',und:'Old translation'}});
    features.saveLyrics('old','test@example.invalid','fr',{fr:'French lyrics',en:'Old lyrics',und:'Old translation'});
    assert.deepEqual(features.lyrics('old','test@example.invalid'),{originalLanguage:'fr',texts:{fr:'French lyrics',en:'Old lyrics',und:'Old translation'}});
  } finally {features.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('migrates saved word translations once and preserves deletions across restarts', () => {
  const dir=mkdtempSync(join(tmpdir(),'shelf-word-migration-'));const path=join(dir,'db.sqlite');const store=new CatalogStore(path);const secret=Buffer.alloc(32,8);
  store.import({generatedAt:'2026-01-01T00:00:00.000Z',tracks:[{id:'old',title:'Old',artist:'Artist',album:'',year:null,status:'pending',file:null}]});
  const db=new DatabaseSync(path);db.exec('CREATE TABLE song_word_translations (track_id TEXT NOT NULL,email TEXT NOT NULL,source_language TEXT NOT NULL,target_language TEXT NOT NULL,word TEXT NOT NULL,translation TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(track_id,email,source_language,target_language,word))');db.prepare('INSERT INTO song_word_translations VALUES(?,?,?,?,?,?,?)').run('old','a@example.invalid','en','ru','love','любовь','2026-01-01');db.close();
  let features=new Features(path,secret);try {
    const migrated=features.wordTranslations('old','a@example.invalid','en','Love')!;assert.equal(migrated.length,1);assert.equal(migrated[0].translation,'любовь');assert.equal(migrated[0].ai,false);
    assert.equal(features.deleteWordTranslation('old','a@example.invalid',migrated[0].id),true);features.close();features=new Features(path,secret);assert.deepEqual(features.wordTranslations('old','a@example.invalid','en','love'),[]);
  } finally {features.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
