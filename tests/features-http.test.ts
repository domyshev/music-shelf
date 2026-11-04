import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Features } from '../server/features.js';
import { CatalogStore } from '../server/store.js';
import { EmailAuth } from '../server/auth.js';
import { createApp } from '../server/http.js';
test('new endpoints require sessions and same origin, and keep credentials private',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'shelf-http-'));const db=join(dir,'data.sqlite');const secret=Buffer.alloc(32,2);const store=new CatalogStore(db);const auth=new EmailAuth(db,secret);const features=new Features(db,secret,async()=>Response.json({choices:[{message:{content:'ok'}}]}));
 store.import({generatedAt:'2026-01-01T00:00:00.000Z',tracks:[{id:'song',title:'Test',artist:'A',album:'',year:null,status:'pending',file:null}]});
 function signIn(email:string){const c=auth.issue(email,email);auth.delivered(c.challengeId);return 'music-shelf-session='+auth.verify(c.challengeId,c.code).token;}
 const one=signIn('one@example.invalid'),two=signIn('two@example.invalid');const server=createApp({store,auth,features,mailer:{async send(){}},origin:'http://test.invalid'}).listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const put=(cookie:string,origin:string,body:object)=>({method:'PUT',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await fetch(base+'/api/ai/settings')).status,401);
  assert.equal((await fetch(base+'/api/ai/settings',put(one,'http://evil.invalid',{model:'a/b',token:'sensitive'}))).status,403);
  const saved=await fetch(base+'/api/ai/settings',put(one,'http://test.invalid',{model:'a/b',token:'sensitive'}));assert.equal(saved.status,200);assert.equal((await saved.text()).includes('sensitive'),false);
  const other=await (await fetch(base+'/api/ai/settings',{headers:{Cookie:two}})).json();assert.deepEqual(other,{model:'',hasToken:false});
  assert.equal((await fetch(base+'/api/tracks/song/text',put(one,'http://evil.invalid',{originalLanguage:'en',texts:{en:'a',ru:'b'}}))).status,403);
  assert.equal((await fetch(base+'/api/tracks/song/text',put(one,'http://test.invalid',{originalLanguage:'en',texts:{en:'a',ru:'b'}}))).status,200);
  assert.deepEqual(await (await fetch(base+'/api/tracks/song/text',{headers:{Cookie:two}})).json(),{originalLanguage:'en',texts:{en:'',ru:'',es:''}});
  assert.equal((await fetch(base+'/api/tracks/song/language',put(one,'http://evil.invalid',{language:'fr'}))).status,403);
  assert.equal((await fetch(base+'/api/tracks/song/language',put(one,'http://test.invalid',{language:'fr'}))).status,200);
  assert.deepEqual(await (await fetch(base+'/api/tracks/song/text',{headers:{Cookie:two}})).json(),{originalLanguage:'fr',texts:{en:'',ru:'',es:''}});
  assert.deepEqual((await (await fetch(base+'/api/tracks/song/text',{headers:{Cookie:one}})).json()).texts,{en:'a',ru:'b'});
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));features.close();auth.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
