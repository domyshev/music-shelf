import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { CatalogStore } from '../server/store.js';
import { EmailAuth } from '../server/auth.js';
import { UploadKeys } from '../server/upload-keys.js';
import { Uploads } from '../server/uploads.js';
import { createApp } from '../server/http.js';

test('upload API authenticates owner, stages bytes and rejects mixed archives',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'shelf-uploads-'));
  const store=new CatalogStore(join(dir,'db')); const auth=new EmailAuth(join(dir,'db'),Buffer.alloc(32,2));
  const keys=new UploadKeys(join(dir,'db'));const uploads=new Uploads(join(dir,'db'),join(dir,'staging'));
  const key=keys.create('owner@example.test','Agent');
  const challenge=auth.issue('owner@example.test','test');auth.delivered(challenge.challengeId);const session=auth.verify(challenge.challengeId,challenge.code);
  const app=createApp({store,auth,uploadKeys:keys,uploads,uploadUsers:['owner@example.test'],mailer:{async send(){}},origin:'http://test.invalid',clientDirectory:'/not-present'});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const form=()=>{const data=new FormData();data.append('files',new Blob(['synthetic audio']), 'song.flac');return data;};
  try {
    assert.equal((await fetch(base+'/api/uploads',{method:'POST',body:form()})).status,401);
    assert.equal((await fetch(base+'/api/uploads',{method:'POST',headers:{Cookie:'music-shelf-session='+session.token},body:form()})).status,403);
    const response=await fetch(base+'/api/uploads',{method:'POST',headers:{Authorization:'Bearer '+key.token},body:form()});assert.equal(response.status,202);
    const report=await response.json() as {status:string;files:{sha256:string}[]};assert.equal(report.status,'staged');assert.equal(report.files[0].sha256,createHash('sha256').update('synthetic audio').digest('hex'));
    const mixed=form();mixed.append('files',new Blob(['zip']),'archive.zip');
    assert.equal((await fetch(base+'/api/uploads',{method:'POST',headers:{Authorization:'Bearer '+key.token},body:mixed})).status,400);
    const history=await (await fetch(base+'/api/uploads',{headers:{Cookie:'music-shelf-session='+session.token}})).json() as {uploads:unknown[]};assert.equal(history.uploads.length,2);
    keys.revoke('owner@example.test',key.id);assert.equal((await fetch(base+'/api/uploads',{method:'POST',headers:{Authorization:'Bearer '+key.token},body:form()})).status,401);
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));uploads.close();keys.close();auth.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
