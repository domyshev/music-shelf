import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { CatalogStore } from './store.js';
import { systemPrompt, selectionInstructions, tools, runTool } from './assistant.js';
import type { Bridge } from './bridge.js';
import { normalizePhrase } from './translation-phrase.js';
import { Tags } from './tags.js';

export function emptyResponseDiagnostic(reason:unknown, completionTokens:unknown, round:number, toolCalls:number) {
  const allowed=['stop','length','content_filter','tool_calls','error','cancelled'];
  return {finishReason:typeof reason==='string'&&allowed.includes(reason)?reason:'unknown',completionTokens:typeof completionTokens==='number'&&Number.isSafeInteger(completionTokens)&&completionTokens>=0?completionTokens:null,round,toolCalls};
}

export class Features {
  private db: DatabaseSync;
  private key: Buffer;
  readonly tags: Tags;
  constructor(path: string, secret: Buffer, private transport: typeof fetch = fetch) {
    this.tags = new Tags(path);
    this.key = createHmac('sha256', secret).update('music-shelf/openrouter-token/v1').digest();
    this.db = new DatabaseSync(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS track_texts (track_id TEXT NOT NULL, email TEXT NOT NULL, lyrics TEXT NOT NULL, translation TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(track_id,email));
      CREATE TABLE IF NOT EXISTS track_text_languages (track_id TEXT NOT NULL, email TEXT NOT NULL, original_language TEXT NOT NULL, texts TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(track_id,email));
      CREATE TABLE IF NOT EXISTS track_original_languages (track_id TEXT PRIMARY KEY, language TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS song_word_translations (track_id TEXT NOT NULL, email TEXT NOT NULL, source_language TEXT NOT NULL, target_language TEXT NOT NULL, word TEXT NOT NULL, translation TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(track_id,email,source_language,target_language,word));
      CREATE TABLE IF NOT EXISTS ai_settings (email TEXT PRIMARY KEY, model TEXT NOT NULL, token BLOB, iv BLOB, tag BLOB);
      CREATE TABLE IF NOT EXISTS feature_migrations (name TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS song_translation_variants (id INTEGER PRIMARY KEY, track_id TEXT NOT NULL, email TEXT NOT NULL, source_language TEXT NOT NULL, target_language TEXT NOT NULL, word TEXT NOT NULL, translation TEXT NOT NULL, ai INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS song_translation_lookup ON song_translation_variants(track_id,email,source_language,word);`);
    this.db.exec('BEGIN IMMEDIATE');try {
      if(!this.db.prepare('SELECT 1 FROM feature_migrations WHERE name=?').get('song_translation_variants_v1')) {
        this.db.exec(`INSERT INTO song_translation_variants(track_id,email,source_language,target_language,word,translation,ai,updated_at) SELECT track_id,email,source_language,target_language,word,translation,0,updated_at FROM song_word_translations`);
        this.db.prepare('INSERT INTO feature_migrations VALUES(?)').run('song_translation_variants_v1');
      }
      this.db.exec('COMMIT');
    } catch(error) {this.db.exec('ROLLBACK');throw error;}
  }
  close() { this.tags.close(); this.db.close(); }
  lyrics(id: string, email: string) {
    if (!this.db.prepare('SELECT 1 FROM tracks WHERE id=?').get(id)) return null;
    const row = this.db.prepare('SELECT original_language, texts FROM track_text_languages WHERE track_id=? AND email=?').get(id, email) as {original_language:string;texts:string}|undefined;
    const explicit = this.db.prepare('SELECT language FROM track_original_languages WHERE track_id=?').get(id) as {language:string}|undefined;
    const legacyLanguages = this.db.prepare("SELECT DISTINCT original_language FROM track_text_languages WHERE track_id=? AND original_language<>'und'").all(id) as {original_language:string}[];
    const originalLanguage = explicit?.language ?? (legacyLanguages.length === 1 ? legacyLanguages[0].original_language : null);
    if (row) return {originalLanguage,texts:JSON.parse(row.texts)};
    const legacy=this.db.prepare('SELECT lyrics, translation FROM track_texts WHERE track_id=? AND email=?').get(id,email) as {lyrics:string;translation:string}|undefined;
    return {originalLanguage:originalLanguage ?? (legacy?.lyrics ? 'en' : null),texts:{en:legacy?.lyrics ?? '',ru:'',es:'',...(legacy?.translation?{und:legacy.translation}:{})}};
  }
  saveLyrics(id: string, email: string, originalLanguage: string, texts: Record<string,string>) {
    if (!this.db.prepare('SELECT 1 FROM tracks WHERE id=?').get(id)) return false;
    this.db.prepare(`INSERT INTO track_text_languages VALUES(?,?,?,?,?) ON CONFLICT(track_id,email) DO UPDATE SET original_language=excluded.original_language,texts=excluded.texts,updated_at=excluded.updated_at`).run(id,email,originalLanguage,JSON.stringify(texts),new Date().toISOString());
    return true;
  }
  wordTranslations(id:string,email:string,sourceLanguage:string,word:string) {
    if (!this.db.prepare('SELECT 1 FROM tracks WHERE id=?').get(id)) return null;
    const rows=this.db.prepare('SELECT id, target_language AS targetLanguage, translation, ai FROM song_translation_variants WHERE track_id=? AND email=? AND source_language=? AND word=? ORDER BY target_language,id').all(id,email,sourceLanguage,normalizePhrase(word)) as {id:number;targetLanguage:string;translation:string;ai:number}[];
    return rows.map(row=>({...row,ai:Boolean(row.ai)}));
  }
  saveWordTranslations(id:string,email:string,sourceLanguage:string,targetLanguage:string,entries:{word:string;translation:string}[],ai=false) {
    if (!this.db.prepare('SELECT 1 FROM tracks WHERE id=?').get(id)) return false;
    const insert=this.db.prepare('INSERT INTO song_translation_variants(track_id,email,source_language,target_language,word,translation,ai,updated_at) VALUES(?,?,?,?,?,?,?,?)');
    this.db.exec('BEGIN IMMEDIATE');try {for(const entry of entries)insert.run(id,email,sourceLanguage,targetLanguage,normalizePhrase(entry.word),entry.translation,ai?1:0,new Date().toISOString());this.db.exec('COMMIT');} catch(error) {this.db.exec('ROLLBACK');throw error;}
    return true;
  }
  updateWordTranslation(id:string,email:string,variantId:number,translation:string) {
    return this.db.prepare('UPDATE song_translation_variants SET translation=?,updated_at=? WHERE id=? AND track_id=? AND email=?').run(translation,new Date().toISOString(),variantId,id,email).changes>0;
  }
  deleteWordTranslation(id:string,email:string,variantId:number) {
    return this.db.prepare('DELETE FROM song_translation_variants WHERE id=? AND track_id=? AND email=?').run(variantId,id,email).changes>0;
  }
  setOriginalLanguage(id: string, language: string) {
    if (!this.db.prepare('SELECT 1 FROM tracks WHERE id=?').get(id)) return false;
    this.db.prepare('INSERT INTO track_original_languages VALUES(?,?,?) ON CONFLICT(track_id) DO UPDATE SET language=excluded.language,updated_at=excluded.updated_at').run(id,language,new Date().toISOString());
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
    const body = await response.json() as {data?: {id:string;name:string;pricing?:{prompt?:string;completion?:string};supported_parameters?:string[]}[]};
    return (body.data ?? []).filter(model => typeof model.id === 'string' && typeof model.name === 'string').map(({id,name,pricing,supported_parameters}) => ({id,name,pricing,supportsTools: supported_parameters?.includes('tools') ?? false}));
  }
  async chat(email: string, messages: {role:'user'|'assistant';content:string}[], store: CatalogStore, bridge?: Bridge, canQueue=false) {
    const settings = this.credential(email); if (!settings) return null;
    const found = new Map();
    const conversation: object[] = [{role:'system',content:systemPrompt + selectionInstructions}, ...messages];
    let totalCalls=0;
    for (let round=0;round<12;round++) {
      const response = await this.transport('https://openrouter.ai/api/v1/chat/completions', {
        method:'POST', signal:AbortSignal.timeout(90000), headers:{Authorization:`Bearer ${settings.token}`,'Content-Type':'application/json'},
        body:JSON.stringify({model:settings.model,messages:conversation,tools:tools(Boolean(bridge),canQueue),max_tokens:16384}),
      });
      if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}`);
      let result:{usage?:{completion_tokens?:unknown};choices?:{finish_reason?:unknown;message?:{role?:string;content?:unknown;tool_calls?:{id:string;type:string;function:{name:string;arguments:string}}[]}}[]};
      try{result=await response.json() as typeof result;}catch{throw new Error('Malformed OpenRouter JSON');}
      const message=result.choices?.[0]?.message; if (!message) throw new Error('OpenRouter returned no message');
      const calls=message.tool_calls;
      if (!calls?.length) {const content=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.filter((part):part is {type:string;text:string}=>Boolean(part&&typeof part==='object'&&part.type==='text'&&typeof part.text==='string')).map(part=>part.text).join(''):'';if(!content){console.error('Music Shelf assistant diagnostic:',JSON.stringify(emptyResponseDiagnostic(result.choices?.[0]?.finish_reason,result.usage?.completion_tokens,round+1,totalCalls)));throw new Error('OpenRouter returned no text');}return content;}
      if(!Array.isArray(calls)||calls.some(call=>!call||!call.id||call.type!=='function'||!call.function||typeof call.function.name!=='string'||typeof call.function.arguments!=='string'))throw new Error('Invalid tool calls');
      totalCalls+=calls.length;if(calls.length>40||totalCalls>100)throw new Error('Too many tool calls');
      conversation.push({role:'assistant',content:typeof message.content==='string'?message.content:null,tool_calls:calls});
      for(const call of calls) {
        let output:unknown; try{output=await runTool(store,this,email,bridge,canQueue,found,call.function.name,call.function.arguments);}catch(error){output={error: error instanceof Error && error.message.startsWith('Corgi did not respond') ? error.message : 'Tool request failed or is not permitted'};}
        conversation.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(output)});
      }
    }
    throw new Error('Tool request limit reached');
  }
}
