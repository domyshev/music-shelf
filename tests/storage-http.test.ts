import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { CatalogStore } from '../server/store.js';
import { EmailAuth } from '../server/auth.js';
import { UploadKeys } from '../server/upload-keys.js';
import { Uploads } from '../server/uploads.js';
import { StorageAuth } from '../server/storage-auth.js';
import { Features } from '../server/features.js';
import { createApp } from '../server/http.js';

test('signed storage confirms files, preserves legacy identities and rejects replay and retired APIs',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'shelf-storage-')),db=join(dir,'db');
 const store=new CatalogStore(db),auth=new EmailAuth(db,Buffer.alloc(32,2)),keys=new UploadKeys(db),uploads=new Uploads(db,join(dir,'staging')),pair=generateKeyPairSync('ed25519'),storageAuth=new StorageAuth(db,pair.publicKey),features=new Features(db,Buffer.alloc(32,3));
 const owner='owner@example.test',key=keys.create(owner,'test');
 const checksum=createHash('sha256').update('test audio').digest('hex');
 const track={id:'legacy-track',title:'Original song',artist:'Original artist',album:'',year:null,status:'ready' as const,file:{name:'song.flac',sizeBytes:10,sha256:checksum,format:'flac',codec:'flac',sampleRate:44100,bitDepth:16,channels:2,durationSeconds:2,bitrateBps:100}};
 store.import({generatedAt:'2026-01-01T00:00:00Z',tracks:[track]});features.saveLyrics(track.id,owner,'en',{en:'Preserved lyrics'});
 const server=createApp({store,auth,features,uploadKeys:keys,uploads,storageAuth,uploadUsers:[owner],origin:'http://test.invalid',mailer:{async send(){}},clientDirectory:'/not-present'}).listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const signed=(path:string,payload:object)=>{const body=JSON.stringify({nonce:randomBytes(16).toString('hex'),...payload}),stamp=String(Math.floor(Date.now()/1000));return {method:'POST',body,headers:{'Content-Type':'application/json','X-Shelf-Timestamp':stamp,'X-Shelf-Signature':sign(null,Buffer.from(stamp+'\n'+path+'\n'+body),pair.privateKey).toString('base64')}};};
 try{
  for(const path of ['/api/bridge/claim','/api/bridge/complete','/api/bridge/selections','/api/download/settings'])assert.equal((await fetch(base+path,{method:'POST'})).status,404);
  const form=new FormData();form.append('files',new Blob(['test audio']),'song.flac');const accepted=await fetch(base+'/api/uploads',{method:'POST',headers:{Authorization:'Bearer '+key.token},body:form});assert.equal(accepted.status,202);const upload=await accepted.json() as {id:string};
  assert.equal((await fetch(base+'/api/uploads/'+upload.id,{headers:{Authorization:'Bearer '+key.token}})).status,200);
  assert.equal((await fetch(base+'/api/storage/poll',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  const poll=signed('/api/storage/poll',{});assert.equal((await fetch(base+'/api/storage/poll',poll)).status,200);assert.equal((await fetch(base+'/api/storage/poll',poll)).status,403);
  assert.equal(await (await fetch(base+'/api/storage/file',signed('/api/storage/file',{id:upload.id,index:0}))).text(),'test audio');
  const changed={...track,file:{...track.file,sha256:'b'.repeat(64)}};
  assert.equal((await fetch(base+'/api/storage/complete',signed('/api/storage/complete',{id:upload.id,results:[{ok:true,index:0,track:changed}]}))).status,400);
  const result=await fetch(base+'/api/storage/complete',signed('/api/storage/complete',{id:upload.id,results:[{ok:true,index:0,track}]}));assert.equal(result.status,200);
  const report=await result.json() as {status:string;files:{trackId:string}[]};assert.equal(report.status,'complete');assert.equal(report.files[0].trackId,'legacy-track');assert.equal(store.catalog().tracks.length,1);assert.equal(features.lyrics('legacy-track',owner)?.texts.en,'Preserved lyrics');assert.equal(existsSync(join(dir,'staging',upload.id)),false);
  assert.equal((await fetch(base+'/api/storage/complete',signed('/api/storage/complete',{id:upload.id,results:[]}))).status,200);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));features.close();storageAuth.close();uploads.close();keys.close();auth.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
