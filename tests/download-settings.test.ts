import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bridge } from '../server/bridge.js';
import { CatalogStore } from '../server/store.js';
import { EmailAuth } from '../server/auth.js';
import { createApp } from '../server/http.js';

test('download settings use the bridge and only the owner may change them',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'shelf-retry-settings-')),db=join(dir,'db.sqlite'),store=new CatalogStore(db),auth=new EmailAuth(db,Buffer.alloc(32,8)),bridge=new Bridge(db);
 const signIn=(email:string)=>{const c=auth.issue(email,email);auth.delivered(c.challengeId);return 'music-shelf-session='+auth.verify(c.challengeId,c.code).token;};
 const owner=signIn('owner@example.invalid'),other=signIn('other@example.invalid');const server=createApp({store,auth,bridge,queueUsers:['owner@example.invalid'],mailer:{async send(){}},origin:'http://test.invalid'}).listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;let running=true;const seen:string[]=[];
 const pump=(async()=>{while(running){const job=bridge.claim();if(!job){await new Promise(r=>setTimeout(r,10));continue;}seen.push(job.kind);if(job.kind==='retry_settings')bridge.complete(job.id,{auto_stop:true,max_attempts:100});else if(job.kind==='set_retry_settings')bridge.complete(job.id,job.payload);}})();
 const put=(cookie:string,origin:string,body:object)=>({method:'PUT',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{assert.equal((await fetch(base+'/api/download/settings')).status,401);assert.equal((await fetch(base+'/api/download/settings',put(other,'http://test.invalid',{enabled:false,maxAttempts:100}))).status,403);assert.equal((await fetch(base+'/api/download/settings',put(owner,'http://evil.invalid',{enabled:false,maxAttempts:100}))).status,403);assert.equal((await fetch(base+'/api/download/settings',put(owner,'http://test.invalid',{enabled:true,maxAttempts:0}))).status,400);
 assert.deepEqual(await (await fetch(base+'/api/download/settings',{headers:{Cookie:owner}})).json(),{enabled:true,maxAttempts:100,canEdit:true});assert.deepEqual(await (await fetch(base+'/api/download/settings',put(owner,'http://test.invalid',{enabled:false,maxAttempts:100}))).json(),{enabled:false,maxAttempts:100,canEdit:true});assert.deepEqual(seen,['retry_settings','set_retry_settings']);
 }finally{running=false;await pump;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));bridge.close();auth.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
