import { DatabaseSync } from 'node:sqlite';

export type ChatTurn = {id:number; requestId:string; message:string; reply:string|null; state:'pending'|'complete'|'failed'; createdAt:string};
export class ChatBusy extends Error {}
export class ChatDuplicate extends Error {}

export class ChatHistory {
  private db: DatabaseSync;
  private active = new Set<string>();
  constructor(path:string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS ai_chat_turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, request_id TEXT NOT NULL,
      message TEXT NOT NULL, reply TEXT, state TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(email, request_id));
      CREATE INDEX IF NOT EXISTS ai_chat_turns_email_id ON ai_chat_turns(email, id DESC);`);
  }
  recoverInterrupted() {
    // A process restart cannot safely replay a turn that may have used tools.
    this.db.prepare("UPDATE ai_chat_turns SET state='failed' WHERE state='pending'").run();
  }
  close() { this.db.close(); }
  page(email:string,before?:number,limit=50) {
    const rows = this.db.prepare(`SELECT id,request_id AS requestId,message,reply,state,created_at AS createdAt
      FROM ai_chat_turns WHERE email=? AND (? IS NULL OR id<?) ORDER BY id DESC LIMIT ?`).all(email,before??null,before??null,limit+1) as ChatTurn[];
    const hasMore=rows.length>limit;
    const turns=rows.slice(0,limit).reverse();
    return {turns, nextBefore:hasMore ? turns[0].id : null};
  }
  turn(email:string,requestId:string) {
    return this.db.prepare('SELECT id,request_id AS requestId,message,reply,state,created_at AS createdAt FROM ai_chat_turns WHERE email=? AND request_id=?').get(email,requestId) as ChatTurn|undefined;
  }
  begin(email:string,requestId:string,message:string) {
    if(this.active.has(email)) throw new ChatBusy();
    try {
      this.db.prepare("INSERT INTO ai_chat_turns(email,request_id,message,state,created_at) VALUES(?,?,?,'pending',?)").run(email,requestId,message,new Date().toISOString());
    } catch(error) {
      if(this.db.prepare('SELECT 1 FROM ai_chat_turns WHERE email=? AND request_id=?').get(email,requestId)) throw new ChatDuplicate();
      throw error;
    }
    this.active.add(email);
  }
  context(email:string,requestId:string) {
    const rows=this.db.prepare("SELECT message,reply,state FROM ai_chat_turns WHERE email=? AND (state='complete' OR request_id=?) ORDER BY id DESC LIMIT 15").all(email,requestId) as {message:string;reply:string|null;state:string}[];
    return rows.reverse().flatMap(row=>[{role:'user' as const,content:row.message},...(row.state==='complete'&&row.reply?[{role:'assistant' as const,content:row.reply}]:[])]);
  }
  complete(email:string,requestId:string,reply:string) {
    try {this.db.prepare("UPDATE ai_chat_turns SET state='complete',reply=? WHERE email=? AND request_id=? AND state='pending'").run(reply,email,requestId);}
    finally {this.active.delete(email);}
  }
  fail(email:string,requestId:string) {
    try {this.db.prepare("UPDATE ai_chat_turns SET state='failed' WHERE email=? AND request_id=? AND state='pending'").run(email,requestId);}
    finally {this.active.delete(email);}
  }
}
