import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CatalogStore } from '../server/store.js';
import { Features, emptyResponseDiagnostic } from '../server/features.js';
import { runTool, tools } from '../server/assistant.js';

test('empty model response diagnostics only include allowlisted metadata',()=>{
 assert.deepEqual(emptyResponseDiagnostic('length',4096,3,2),{finishReason:'length',completionTokens:4096,round:3,toolCalls:2});
 assert.deepEqual(emptyResponseDiagnostic('private response content','secret',1,0),{finishReason:'unknown',completionTokens:null,round:1,toolCalls:0});
});

test('output limit persists per user and is sent only when selected',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'shelf-limit-'));const db=join(dir,'db.sqlite'),store=new CatalogStore(db);const bodies:Record<string,unknown>[]=[];
 const transport:typeof fetch=async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return Response.json({choices:[{message:{content:'ok'}}]});};
 let features=new Features(db,Buffer.alloc(32,3),transport);
 try{features.saveSettings('one@example.invalid','model','token');features.setOutputLimit('one@example.invalid',16384);features.close();features=new Features(db,Buffer.alloc(32,3),transport);assert.equal(features.outputLimit('one@example.invalid'),16384);assert.equal(features.outputLimit('two@example.invalid'),null);await features.chat('one@example.invalid',[{role:'user',content:'hello'}],store);assert.equal(bodies[0].max_tokens,16384);features.setOutputLimit('one@example.invalid',null);await features.chat('one@example.invalid',[{role:'user',content:'hello'}],store);assert.equal('max_tokens' in bodies[1],false);}
 finally{features.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('AI tool loop reads actual catalog and reports tool results to the model',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'shelf-assistant-'));const db=join(dir,'db.sqlite');const store=new CatalogStore(db);let calls=0;
 const transport:typeof fetch=async(_url,init)=>{const data=JSON.parse(String(init?.body));calls++;
  if(calls===1){assert.equal('max_tokens' in data,false);assert.ok(data.tools.some((t:{function:{name:string}})=>t.function.name==='search_library'));assert.match(data.messages[0].content,/Create the tag after identifying the selection/);assert.match(data.messages[0].content,/Never claim a playlist was created or synchronized without a tool result/);return Response.json({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'call1',type:'function',function:{name:'search_library',arguments:JSON.stringify({query:'Hendrix'})}}]}}]});}
  const result=data.messages.find((m:{role:string})=>m.role==='tool');assert.ok(result.content.includes('Little Wing'));assert.equal(result.tool_call_id,'call1');return Response.json({choices:[{message:{content:'Found Little Wing'}}]});};
 const feature=new Features(db,Buffer.alloc(32,4),transport);try{
  store.import({generatedAt:'2026-01-01T00:00:00.000Z',tracks:[{id:'123',title:'Little Wing',artist:'Jimi Hendrix',album:'',year:null,status:'pending',file:null}]});
  feature.saveSettings('a@example.invalid','model/name','secret');assert.equal(await feature.chat('a@example.invalid',[{role:'user',content:'Find Hendrix'}],store),'Found Little Wing');assert.equal(calls,2);
 }finally{feature.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('lyrics tools preserve other languages and isolate accounts',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'shelf-assistant-text-'));const db=join(dir,'db.sqlite');const store=new CatalogStore(db);const feature=new Features(db,Buffer.alloc(32,5));
 try{
  store.import({generatedAt:'2026-01-01T00:00:00.000Z',tracks:[{id:'song',title:'Song',artist:'Artist',album:'',year:null,status:'pending',file:null}]});
  await runTool(store,feature,'a@example.invalid','save_song_text',JSON.stringify({track_id:'song',language:'fr',text:'original'}));
  await runTool(store,feature,'a@example.invalid','save_song_text',JSON.stringify({track_id:'song',language:'ru',text:'translation'}));
  await runTool(store,feature,'a@example.invalid','save_song_text',JSON.stringify({track_id:'song',language:'fr',text:'> original'}));
  feature.setOriginalLanguage('song','fr');const own=feature.lyrics('song','a@example.invalid');assert.equal(own?.originalLanguage,'fr');assert.equal(feature.lyrics('song','b@example.invalid')?.originalLanguage,'fr');assert.equal(own?.texts.fr,'> original');assert.equal(own?.texts.ru,'translation');assert.equal(feature.lyrics('song','b@example.invalid')?.texts.fr,undefined);
  await runTool(store,feature,'a@example.invalid','save_word_translations',JSON.stringify({track_id:'song',source_language:'en',target_language:'ru',entries:[{word:'Love',translation:'любовь'}]}));
  assert.deepEqual(await runTool(store,feature,'a@example.invalid','read_word_translations',JSON.stringify({track_id:'song',source_language:'en',word:'LOVE'})),[{id:1,targetLanguage:'ru',translation:'любовь',ai:true}]);
  assert.deepEqual(await runTool(store,feature,'b@example.invalid','read_word_translations',JSON.stringify({track_id:'song',source_language:'en',word:'love'})),[]);
  await runTool(store,feature,'a@example.invalid','save_word_translations',JSON.stringify({track_id:'song',source_language:'en',target_language:'ru',entries:[{word:'Love is all',translation:'Любовь — это всё'}]}));
  assert.deepEqual(await runTool(store,feature,'a@example.invalid','read_word_translations',JSON.stringify({track_id:'song',source_language:'en',word:' LOVE   IS ALL '})),[{id:2,targetLanguage:'ru',translation:'Любовь — это всё',ai:true}]);
  assert.deepEqual(await runTool(store,feature,'a@example.invalid','read_word_translations',JSON.stringify({track_id:'song',source_language:'en',word:'love'})),[{id:1,targetLanguage:'ru',translation:'любовь',ai:true}]);
  for(const name of ['search_music','enqueue_tracks','queue_status']) {
    assert.equal(tools().some(t=>t.function.name===name),false);
    await assert.rejects(runTool(store,feature,'b@example.invalid',name,'{}'));
  }
 }finally{feature.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('selection tags retain the library context and reject unknown tracks and isolate owners',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'shelf-selection-'));const db=join(dir,'db.sqlite');const store=new CatalogStore(db),features=new Features(db,Buffer.alloc(32,7));
 try{
  store.import({generatedAt:'2026-01-01T00:00:00.000Z',tracks:[{id:'existing',title:'Song',artist:'Artist',album:'',year:null,status:'pending',file:null}]});
  const args=JSON.stringify({association:'moon.dust',description:'Expand the collection',track_ids:['existing']});
  await assert.rejects(runTool(store,features,'a@example.invalid','create_selection_tag',JSON.stringify({association:'moon.dust',description:'Test',track_ids:['unknown']})));
  const tag=await runTool(store,features,'a@example.invalid','create_selection_tag',args) as {name:string;basis:{tracks:{id:string}[]}};
  assert.equal(tag.name,'agent-moon.dust-1');assert.equal(tag.basis.tracks[0].id,'existing');
  assert.deepEqual(await runTool(store,features,'b@example.invalid','list_selection_tags','{}'),[]);
 }finally{features.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('assistant handles thirty tool calls in one response and multipart text',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'shelf-batch-')),db=join(dir,'db.sqlite'),store=new CatalogStore(db);let round=0;
 const transport:typeof fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body));round++;if(round===1)return Response.json({choices:[{message:{role:'assistant',content:null,tool_calls:Array.from({length:30},(_,i)=>({id:`call-${i}`,type:'function',function:{name:'search_library',arguments:JSON.stringify({query:'song'})}}))}}]});assert.equal(body.messages.filter((m:{role:string})=>m.role==='tool').length,30);return Response.json({choices:[{message:{content:[{type:'text',text:'Recommendations ready'}]}}]});};
 const feature=new Features(db,Buffer.alloc(32,3),transport);try{store.import({generatedAt:'2026-01-01T00:00:00.000Z',tracks:[{id:'song',title:'Song',artist:'Artist',album:'',year:null,status:'pending',file:null}]});feature.saveSettings('a@example.invalid','model','token');assert.equal(await feature.chat('a@example.invalid',[{role:'user',content:'Recommend songs'}],store),'Recommendations ready');assert.equal(round,2);}finally{feature.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
