import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

type Kind = 'search' | 'queue_status' | 'enqueue';
export class Bridge {
  private db: DatabaseSync;
  constructor(path:string) {
    this.db=new DatabaseSync(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS bridge_requests (id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,lease_until INTEGER,result TEXT); CREATE INDEX IF NOT EXISTS bridge_requests_state ON bridge_requests(state,created); CREATE TABLE IF NOT EXISTS bridge_nonces (nonce TEXT PRIMARY KEY,expires INTEGER NOT NULL);`);
  }
  close(){this.db.close();}
  nonce(nonce:string,now:number) {this.db.prepare('DELETE FROM bridge_nonces WHERE expires<?').run(now);try{this.db.prepare('INSERT INTO bridge_nonces VALUES(?,?)').run(nonce,now+600000);return true;}catch{return false;}}
  async execute(kind:Kind,payload:object,timeout=65000) {
    const now=Date.now();this.db.prepare("DELETE FROM bridge_requests WHERE expires<?").run(now-86400000);
    const pending=this.db.prepare("SELECT count(*) AS n FROM bridge_requests WHERE state IN ('pending','leased') AND expires>?").get(now) as {n:number};
    if(pending.n>=50)throw new Error('Bridge is busy');
    const id=randomUUID();this.db.prepare('INSERT INTO bridge_requests(id,kind,payload,state,created,expires) VALUES(?,?,?,?,?,?)').run(id,kind,JSON.stringify(payload),'pending',now,now+timeout);
    while(Date.now()<now+timeout) {
      const row=this.db.prepare('SELECT state,result FROM bridge_requests WHERE id=?').get(id) as {state:string;result:string|null}|undefined;
      if(row?.state==='done'&&row.result) return JSON.parse(row.result) as unknown;
      await new Promise(resolve=>setTimeout(resolve,400));
    }
    this.db.prepare("UPDATE bridge_requests SET state='expired' WHERE id=? AND state='pending'").run(id);
    throw new Error('Corgi did not respond in time; request may still be processing');
  }
  claim() {
    const now=Date.now();this.db.exec('BEGIN IMMEDIATE');
    try {
      const row=this.db.prepare("SELECT id,kind,payload,expires FROM bridge_requests WHERE expires>? AND (state='pending' OR (state='leased' AND lease_until<?)) ORDER BY created LIMIT 1").get(now,now) as {id:string;kind:Kind;payload:string;expires:number}|undefined;
      if(!row){this.db.exec('COMMIT');return null;}
      this.db.prepare("UPDATE bridge_requests SET state='leased',lease_until=? WHERE id=?").run(now+90000,row.id);this.db.exec('COMMIT');return {...row,payload:JSON.parse(row.payload)};
    } catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  complete(id:string,result:unknown) {const body=JSON.stringify(result);if(body.length>250000)throw new Error('Result too large');return this.db.prepare("UPDATE bridge_requests SET state='done',result=? WHERE id=? AND state='leased'").run(body,id).changes===1;}
}
