import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Features } from '../server/features.js';
import { CatalogStore } from '../server/store.js';
import { ChatHistory } from '../server/chat-history.js';
import { EmailAuth } from '../server/auth.js';
import { createApp } from '../server/http.js';

test('translation jobs use their model, save only the selected phrase, and stay out of chat history',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'shelf-translation-')),path=join(dir,'db.sqlite'),secret=Buffer.alloc(32,8);const store=new CatalogStore(path),auth=new EmailAuth(path,secret),history=new ChatHistory(path);const models:string[]=[];let calls=0;
 const features=new Features(path,secret,async(_url,init)=>{const body=JSON.parse(String(init?.body));models.push(body.model);calls++;return Response.json(calls===1?{choices:[{message:{tool_calls:[{id:'call-1',type:'function',function:{name:'save_word_translations',arguments:JSON.stringify({track_id:'song',source_language:'es',target_language:'ru',entries:[{word:'blanco',translation:'белый'}]})}}]}}]}:{choices:[{message:{content:'Saved'}}]});});
 store.import({generatedAt:'2026-01-01T00:00:00.000Z',tracks:[{id:'song',title:'Song',artist:'Artist',album:'',year:null,status:'pending',file:null}]});
 features.saveSettings('one@example.invalid','chat/model','secret',false,'translate/model');
 const login=(email:string)=>{const c=auth.issue(email,email);auth.delivered(c.challengeId);return 'music-shelf-session='+auth.verify(c.challengeId,c.code).token;};const one=login('one@example.invalid'),two=login('two@example.invalid');
 const server=createApp({store,auth,features,chatHistory:history,mailer:{async send(){}},origin:'http://test.invalid'}).listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 try{const requestId=randomUUID(),body={requestId,trackId:'song',sourceLanguage:'es',targetLanguage:'ru',word:'blanco'};const result=await fetch(base+'/api/ai/translations',{method:'POST',headers:{Cookie:one,Origin:'http://test.invalid','Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(result.status,202);
 let state='pending';for(let i=0;i<100&&state==='pending';i++){await new Promise(resolve=>setTimeout(resolve,10));state=(await (await fetch(base+'/api/ai/translations/'+requestId,{headers:{Cookie:one}})).json()).state;}
 assert.equal(state,'complete');assert.deepEqual(models,['translate/model','translate/model']);assert.equal(features.wordTranslations('song','one@example.invalid','es','blanco')?.[0].translation,'белый');assert.deepEqual(history.page('one@example.invalid').turns,[]);assert.equal((await fetch(base+'/api/ai/translations/'+requestId,{headers:{Cookie:two}})).status,404);assert.equal((await fetch(base+'/api/ai/translations',{method:'POST',headers:{Cookie:one,Origin:'http://evil.invalid','Content-Type':'application/json'},body:JSON.stringify(body)})).status,403);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));features.close();history.close();auth.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
