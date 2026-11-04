import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CatalogStore } from '../server/store.js';
import { Features } from '../server/features.js';
import { runTool, tools } from '../server/assistant.js';
import { Bridge } from '../server/bridge.js';

test('AI tool loop reads actual catalog and reports tool results to the model',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'shelf-assistant-'));const db=join(dir,'db.sqlite');const store=new CatalogStore(db);let calls=0;
 const transport:typeof fetch=async(_url,init)=>{const data=JSON.parse(String(init?.body));calls++;
  if(calls===1){assert.ok(data.tools.some((t:{function:{name:string}})=>t.function.name==='search_library'));return Response.json({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'call1',type:'function',function:{name:'search_library',arguments:JSON.stringify({query:'Hendrix'})}}]}}]});}
  const result=data.messages.find((m:{role:string})=>m.role==='tool');assert.ok(result.content.includes('Little Wing'));assert.equal(result.tool_call_id,'call1');return Response.json({choices:[{message:{content:'Found Little Wing'}}]});};
 const feature=new Features(db,Buffer.alloc(32,4),transport);try{
  store.import({generatedAt:'2026-01-01T00:00:00.000Z',tracks:[{id:'123',title:'Little Wing',artist:'Jimi Hendrix',album:'',year:null,status:'pending',file:null}]});
  feature.saveSettings('a@example.invalid','model/name','secret');assert.equal(await feature.chat('a@example.invalid',[{role:'user',content:'Find Hendrix'}],store),'Found Little Wing');assert.equal(calls,2);
 }finally{feature.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('lyrics tools preserve other languages and isolate accounts',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'shelf-assistant-text-'));const db=join(dir,'db.sqlite');const store=new CatalogStore(db);const feature=new Features(db,Buffer.alloc(32,5));const found=new Map();
 try{
  store.import({generatedAt:'2026-01-01T00:00:00.000Z',tracks:[{id:'song',title:'Song',artist:'Artist',album:'',year:null,status:'pending',file:null}]});
  await runTool(store,feature,'a@example.invalid',undefined,false,found,'save_song_text',JSON.stringify({track_id:'song',language:'fr',text:'original'}));
  await runTool(store,feature,'a@example.invalid',undefined,false,found,'save_song_text',JSON.stringify({track_id:'song',language:'ru',text:'translation'}));
  await runTool(store,feature,'a@example.invalid',undefined,false,found,'save_song_text',JSON.stringify({track_id:'song',language:'fr',text:'> original'}));
  feature.setOriginalLanguage('song','fr');const own=feature.lyrics('song','a@example.invalid');assert.equal(own?.originalLanguage,'fr');assert.equal(feature.lyrics('song','b@example.invalid')?.originalLanguage,'fr');assert.equal(own?.texts.fr,'> original');assert.equal(own?.texts.ru,'translation');assert.equal(feature.lyrics('song','b@example.invalid')?.texts.fr,undefined);
  assert.equal(tools(true,false).some(t=>t.function.name==='enqueue_tracks'),false);
  await assert.rejects(runTool(store,feature,'b@example.invalid',undefined,false,found,'enqueue_tracks','{"ids":["1234567890123456789012"]}'));
 }finally{feature.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('bridge delivers and completes a request once',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'shelf-bridge-'));const bridge=new Bridge(join(dir,'db.sqlite'));
 try{const promise=bridge.execute('search',{query:'Hendrix'},2000);const job=bridge.claim();assert.equal(job?.kind,'search');assert.equal(bridge.claim(),null);assert.ok(bridge.complete(job!.id,{tracks:[]}));assert.deepEqual(await promise,{tracks:[]});assert.equal(bridge.complete(job!.id,{tracks:[]}),false);assert.equal(bridge.nonce('a',Date.now()),true);assert.equal(bridge.nonce('a',Date.now()),false);}finally{bridge.close();rmSync(dir,{recursive:true,force:true});}
});

test('agent searches SpotiFLAC before enqueueing and receives live queue status',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'shelf-full-tool-loop-'));const db=join(dir,'db.sqlite');const store=new CatalogStore(db);const bridge=new Bridge(db);const searchId='A'.repeat(22);let round=0;const operations:string[]=[];
 const transport:typeof fetch=async(_url,init)=>{const data=JSON.parse(String(init?.body));round++;const request=(name:string,args:object)=>Response.json({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'call'+round,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]});
  if(round===1)return request('search_music',{query:'Test song'});
  if(round===2){assert.ok(data.messages.at(-1).content.includes(searchId));return request('enqueue_tracks',{ids:[searchId]});}
  if(round===3){assert.ok(data.messages.at(-1).content.includes('queued'));return request('queue_status',{});}
  assert.ok(data.messages.at(-1).content.includes('running'));return Response.json({choices:[{message:{content:'Song queued and currently running'}}]});};
 const feature=new Features(db,Buffer.alloc(32,9),transport);feature.saveSettings('a@example.invalid','model','token');let running=true;
 const pump=(async()=>{while(running){const job=bridge.claim();if(!job){await new Promise(r=>setTimeout(r,10));continue;}operations.push(job.kind);if(job.kind==='search')bridge.complete(job.id,{tracks:[{spotify_id:searchId,title:'Test',artist:'Artist',album:'Album',duration:180,service:'auto'}]});else if(job.kind==='enqueue'){assert.equal(job.payload.tracks[0].spotify_id,searchId);bridge.complete(job.id,{created:1,jobs:[{state:'queued',spotify_id:searchId}]});}else bridge.complete(job.id,{jobs:[{state:'running',spotify_id:searchId}]});}})();
 try{assert.equal(await feature.chat('a@example.invalid',[{role:'user',content:'Download test song'}],store,bridge,true),'Song queued and currently running');assert.deepEqual(operations,['search','enqueue','queue_status']);}finally{running=false;await pump;feature.close();bridge.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('enqueue requires a permitted account and IDs returned by this search',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'shelf-enqueue-'));const db=join(dir,'db.sqlite'),store=new CatalogStore(db),feature=new Features(db,Buffer.alloc(32,7)),bridge=new Bridge(db),found=new Map();
 try{
  assert.ok(tools(true,true).some(t=>t.function.name==='enqueue_tracks'));
  await assert.rejects(runTool(store,feature,'a@example.invalid',bridge,false,found,'enqueue_tracks',JSON.stringify({ids:['A'.repeat(22)]})));
  await assert.rejects(runTool(store,feature,'a@example.invalid',bridge,true,found,'enqueue_tracks',JSON.stringify({ids:['A'.repeat(22)]})));
  assert.equal(bridge.claim(),null);
 }finally{bridge.close();feature.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
