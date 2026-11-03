import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export class Features {
  private db: DatabaseSync;
  private key: Buffer;
  constructor(path: string, secret: Buffer, private transport: typeof fetch = fetch) {
    this.key = createHmac('sha256', secret).update('music-shelf/openrouter-token/v1').digest();
    this.db = new DatabaseSync(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS track_texts (track_id TEXT NOT NULL, email TEXT NOT NULL, lyrics TEXT NOT NULL, translation TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(track_id,email));
      CREATE TABLE IF NOT EXISTS track_text_languages (track_id TEXT NOT NULL, email TEXT NOT NULL, original_language TEXT NOT NULL, texts TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(track_id,email));
      CREATE TABLE IF NOT EXISTS ai_settings (email TEXT PRIMARY KEY, model TEXT NOT NULL, token BLOB, iv BLOB, tag BLOB);`);
  }
  close() { this.db.close(); }
  lyrics(id: string, email: string) {
    if (!this.db.prepare('SELECT 1 FROM tracks WHERE id=?').get(id)) return null;
    const row = this.db.prepare('SELECT original_language, texts FROM track_text_languages WHERE track_id=? AND email=?').get(id, email) as {original_language:string;texts:string}|undefined;
    if (row) return {originalLanguage:row.original_language,texts:JSON.parse(row.texts)};
    const legacy=this.db.prepare('SELECT lyrics, translation FROM track_texts WHERE track_id=? AND email=?').get(id,email) as {lyrics:string;translation:string}|undefined;
    return {originalLanguage:'en',texts:{en:legacy?.lyrics ?? '',ru:'',es:'',...(legacy?.translation?{und:legacy.translation}:{})}};
  }
  saveLyrics(id: string, email: string, originalLanguage: string, texts: Record<string,string>) {
    if (!this.db.prepare('SELECT 1 FROM tracks WHERE id=?').get(id)) return false;
    this.db.prepare(`INSERT INTO track_text_languages VALUES(?,?,?,?,?) ON CONFLICT(track_id,email) DO UPDATE SET original_language=excluded.original_language,texts=excluded.texts,updated_at=excluded.updated_at`).run(id,email,originalLanguage,JSON.stringify(texts),new Date().toISOString());
    return true;
  }
  settings(email: string) {
    const row = this.db.prepare('SELECT model,token FROM ai_settings WHERE email=?').get(email) as {model:string;token:Uint8Array|null}|undefined;
    return { model: row?.model ?? '', hasToken: Boolean(row?.token) };
  }
  saveSettings(email: string, model: string, token?: string, removeToken = false) {
    const row = this.db.prepare('SELECT token,iv,tag FROM ai_settings WHERE email=?').get(email) as {token:Uint8Array|null;iv:Uint8Array|null;tag:Uint8Array|null}|undefined;
    let encrypted = row?.token ?? null, iv = row?.iv ?? null, tag = row?.tag ?? null;
    if (removeToken) { encrypted = iv = tag = null; }
    else if (token) {
      iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv); cipher.setAAD(Buffer.from(email));
      encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]); tag = cipher.getAuthTag();
    }
    this.db.prepare(`INSERT INTO ai_settings(email,model,token,iv,tag) VALUES(?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET model=excluded.model,token=excluded.token,iv=excluded.iv,tag=excluded.tag`).run(email, model, encrypted, iv, tag);
    return this.settings(email);
  }
  private credential(email: string) {
    const row = this.db.prepare('SELECT model,token,iv,tag FROM ai_settings WHERE email=?').get(email) as {model:string;token:Uint8Array|null;iv:Uint8Array|null;tag:Uint8Array|null}|undefined;
    if (!row?.token || !row.iv || !row.tag || !row.model) return null;
    const decipher = createDecipheriv('aes-256-gcm', this.key, row.iv); decipher.setAAD(Buffer.from(email)); decipher.setAuthTag(row.tag);
    return { model: row.model, token: Buffer.concat([decipher.update(row.token), decipher.final()]).toString('utf8') };
  }
  async models() {
    const response = await this.transport('https://openrouter.ai/api/v1/models', {signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error('Model list unavailable');
    const body = await response.json() as {data?: {id:string;name:string;pricing?:{prompt?:string;completion?:string}}[]};
    return (body.data ?? []).filter(model => typeof model.id === 'string' && typeof model.name === 'string').map(({id,name,pricing}) => ({id,name,pricing}));
  }
  async chat(email: string, messages: {role:'user'|'assistant';content:string}[]) {
    const settings = this.credential(email); if (!settings) return null;
    const response = await this.transport('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(90000), headers: { Authorization: `Bearer ${settings.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({model: settings.model, messages: [{role:'system',content:'You are a helpful music assistant. Never claim you have added or downloaded songs. Respond in the user’s language.'}, ...messages], max_tokens: 2000}),
    });
    if (!response.ok) throw new Error(`OpenRouter request failed (${response.status})`);
    const result = await response.json() as {choices?: {message?: {content?: unknown}}[]};
    const content = result.choices?.[0]?.message?.content; if (typeof content !== 'string') throw new Error('OpenRouter returned no text');
    return content;
  }
}
