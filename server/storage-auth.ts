import { verify, type KeyObject } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

/** Authenticate outbound storage-worker requests and reject replayed signatures. */
export class StorageAuth {
  private db: DatabaseSync;
  constructor(path:string, private publicKey:KeyObject) {
    this.db=new DatabaseSync(path);
    this.db.exec('CREATE TABLE IF NOT EXISTS storage_nonces (nonce TEXT PRIMARY KEY, expires INTEGER NOT NULL)');
  }
  close(){this.db.close();}
  authenticate(path:string,timestamp:string,signature:string,body:Buffer) {
    const now=Date.now();
    if(!/^\d{10}$/.test(timestamp)||Math.abs(now-Number(timestamp)*1000)>120000||signature.length>100)return false;
    const bytes=Buffer.from(signature,'base64');
    if(bytes.length!==64||!verify(null,Buffer.concat([Buffer.from(timestamp+'\n'+path+'\n'),body]),this.publicKey,bytes))return false;
    let nonce:unknown;try{nonce=JSON.parse(body.toString('utf8')).nonce;}catch{return false;}
    if(typeof nonce!=='string'||!/^([a-f0-9]{32})$/.test(nonce))return false;
    this.db.prepare('DELETE FROM storage_nonces WHERE expires<?').run(now);
    try{this.db.prepare('INSERT INTO storage_nonces VALUES(?,?)').run(nonce,now+300000);return true;}catch{return false;}
  }
}
