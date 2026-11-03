import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Bridge } from '../server/bridge.js';
import { CatalogStore } from '../server/store.js';
import { EmailAuth } from '../server/auth.js';
import { createApp } from '../server/http.js';

test('Corgi worker signs, retrieves, executes and returns a search through the bridge',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'shelf-bridge-e2e-')),db=join(dir,'db.sqlite'),store=new CatalogStore(db),auth=new EmailAuth(db,Buffer.alloc(32,3)),bridge=new Bridge(db),keys=generateKeyPairSync('ed25519');
 const key=join(dir,'publisher.pem');writeFileSync(key,keys.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
 const app=createApp({store,auth,bridge,publisherKey:keys.publicKey,mailer:{async send(){}},origin:'http://test.invalid'}).listen(0,'127.0.0.1');await once(app,'listening');
 const local=createServer((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({tracks:[{id:'A'.repeat(22),name:'Synthetic Song',artists:'Demo',album_name:'Album',duration_ms:180000}]}));}).listen(0,'127.0.0.1');await once(local,'listening');
 const base=`http://127.0.0.1:${(app.address() as AddressInfo).port}`,localBase=`http://127.0.0.1:${(local.address() as AddressInfo).port}`;
 try{
  const pending=bridge.execute('search',{query:'synthetic'},5000);pending.catch(()=>{});
  const python=`import importlib.util,sys\ns=importlib.util.spec_from_file_location('worker',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nm.SITE=sys.argv[2];m.LOCAL=sys.argv[3];m.KEY=m.Path(sys.argv[4])\nj=m.send('/api/bridge/claim',{})['job'];r=m.run(j);m.send('/api/bridge/complete',{'id':j['id'],'result':r})`;
  const child=spawn('python3',['-B','-c',python,resolve('bridge/spotiflac-worker.py'),base,localBase,key],{stdio:'pipe',env:{...process.env,PATH:`/opt/homebrew/opt/openssl@3/bin:${process.env.PATH??''}`}});let errors='';child.stderr.on('data',chunk=>errors+=chunk.toString());const [code]=await once(child,'exit');assert.equal(code,0,errors);
  const result=await pending as {tracks:{title:string;spotify_id:string}[]};assert.equal(result.tracks[0].title,'Synthetic Song');assert.equal(result.tracks[0].spotify_id,'A'.repeat(22));
 }finally{app.closeAllConnections();local.closeAllConnections();await Promise.all([new Promise<void>(r=>app.close(()=>r())),new Promise<void>(r=>local.close(()=>r()))]);bridge.close();auth.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
