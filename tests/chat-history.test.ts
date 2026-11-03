import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {randomUUID} from 'node:crypto';
import {ChatHistory,ChatBusy,ChatDuplicate} from '../server/chat-history.js';
import {CatalogStore} from '../server/store.js';
import {EmailAuth} from '../server/auth.js';
import {Features} from '../server/features.js';
import {createApp} from '../server/http.js';

test('history persists per user, pages all messages, and does not replay interrupted turns',()=>{
 const dir=mkdtempSync(join(tmpdir(),'music-chat-')),path=join(dir,'db.sqlite');let history=new ChatHistory(path);
 try {
  for(let i=0;i<55;i++){const id=randomUUID();history.begin('a',id,`question ${i}`);history.complete('a',id,`answer ${i}`);}
  const pending=randomUUID();history.begin('b',pending,'another user');assert.throws(()=>history.begin('b',randomUUID(),'concurrent'),ChatBusy);
  let page=history.page('a');assert.equal(page.turns.length,50);assert.ok(page.nextBefore);assert.equal(page.turns[0].message,'question 5');assert.equal(history.page('a',page.nextBefore!).turns.length,5);
  assert.equal(history.page('b').turns.length,1);history.close();history=new ChatHistory(path);history.recoverInterrupted();
  assert.equal(history.page('b').turns[0].state,'failed');assert.throws(()=>history.begin('b',pending,'repeat'),ChatDuplicate);
  history.begin('b',randomUUID(),'new question');
 }finally{history.close();rmSync(dir,{recursive:true,force:true});}
});

test('chat API stores turns server-side, isolates accounts and uses persisted context',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'music-chat-http-')),path=join(dir,'db.sqlite'),secret=Buffer.alloc(32,7);const store=new CatalogStore(path),auth=new EmailAuth(path,secret),history=new ChatHistory(path);let calls=0;
 const features=new Features(path,secret,async(_url,init)=>{const body=JSON.parse(String(init?.body));calls++;if(body.messages.at(-1)?.content==='cause failure')throw new Error('Provider failure');if(calls===2){assert.ok(body.messages.some((m:{content:string})=>m.content==='first question'));assert.ok(body.messages.some((m:{content:string})=>m.content==='first answer'));}return Response.json({choices:[{message:{content:calls===1?'first answer':'second answer'}}]});});
 function cookie(email:string){const c=auth.issue(email,email);auth.delivered(c.challengeId);return 'music-shelf-session='+auth.verify(c.challengeId,c.code).token;}
 const one=cookie('one@example.invalid'),two=cookie('two@example.invalid');features.saveSettings('one@example.invalid','model','token');
 const server=createApp({store,auth,features,chatHistory:history,mailer:{async send(){}},origin:'http://test.invalid'}).listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const send=(id:string,message:string,origin='http://test.invalid')=>fetch(base+'/api/ai/chat',{method:'POST',headers:{Cookie:one,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({requestId:id,message})});
 try {
  assert.equal((await fetch(base+'/api/ai/chat/history')).status,401);assert.equal((await send(randomUUID(),'forbidden','http://evil.invalid')).status,403);
  const id=randomUUID();assert.equal((await send(id,'first question')).status,200);assert.equal((await send(id,'first question')).status,409);assert.equal(calls,1);
  assert.equal((await send(randomUUID(),'second question')).status,200);
  const own=await (await fetch(base+'/api/ai/chat/history',{headers:{Cookie:one}})).json() as {turns:{message:string;reply:string}[]};assert.deepEqual(own.turns.map(t=>[t.message,t.reply]),[['first question','first answer'],['second question','second answer']]);
  const failedId=randomUUID();assert.equal((await send(failedId,'cause failure')).status,502);assert.equal((await send(failedId,'cause failure')).status,409);
  const failed=await (await fetch(base+'/api/ai/chat/history',{headers:{Cookie:one}})).json() as {turns:{state:string;message:string}[]};assert.equal(failed.turns.at(-1)?.state,'failed');assert.equal(failed.turns.at(-1)?.message,'cause failure');
  const other=await (await fetch(base+'/api/ai/chat/history',{headers:{Cookie:two}})).json() as {turns:unknown[]};assert.deepEqual(other.turns,[]);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));features.close();history.close();auth.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
