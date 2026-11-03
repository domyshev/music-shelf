import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync,sign } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bridge } from '../server/bridge.js';
import { CatalogStore } from '../server/store.js';
import { EmailAuth } from '../server/auth.js';
import { createApp } from '../server/http.js';

test('bridge requires signed path-bound requests and rejects replay',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'shelf-bridge-http-'));const db=join(dir,'db.sqlite'),store=new CatalogStore(db),auth=new EmailAuth(db,Buffer.alloc(32,8)),bridge=new Bridge(db),keys=generateKeyPairSync('ed25519');
 const server=createApp({store,auth,bridge,publisherKey:keys.publicKey,mailer:{async send(){}},origin:'http://test.invalid'}).listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const request=(path:string,nonce:string,signPath=path)=>{const body=JSON.stringify({nonce});const ts=String(Math.floor(Date.now()/1000));const signature=sign(null,Buffer.from(ts+'\n'+signPath+'\n'+body),keys.privateKey).toString('base64');return {method:'POST',headers:{'Content-Type':'application/json','X-Shelf-Timestamp':ts,'X-Shelf-Signature':signature},body};};
 try{
  assert.equal((await fetch(base+'/api/bridge/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,400);
  assert.equal((await fetch(base+'/api/bridge/claim',request('/api/bridge/claim','a'.repeat(32),'/api/bridge/complete'))).status,403);
  const first=await fetch(base+'/api/bridge/claim',request('/api/bridge/claim','a'.repeat(32)));assert.equal(first.status,200);assert.deepEqual(await first.json(),{job:null});
  assert.equal((await fetch(base+'/api/bridge/claim',request('/api/bridge/claim','a'.repeat(32)))).status,403);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));bridge.close();auth.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
