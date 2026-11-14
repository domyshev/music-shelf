import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, readdir, statfs } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import type { Request } from 'express';
import busboy from 'busboy';
import { unpackArchive } from './upload-archive.js';
import { z } from 'zod';
import { trackSchema } from '../shared/catalog.js';
import type { CatalogStore } from './store.js';

const audio = new Set(['.flac','.mp3','.m4a','.aac','.ogg','.opus','.wav','.aiff','.aif']);
const maxFileBytes = 80 * 1024 * 1024;
const maxTotalBytes = 80 * 1024 * 1024;
const maxFiles = 200;
export type UploadFile = { name: string; sha256: string; sizeBytes: number; status: 'staged'|'ready'|'failed'; success?:boolean|null; trackId?:string; error?:string };
export type UploadReport = { id: string; createdAt: string; kind: 'archive'|'files'; status: 'staged'|'complete'|'partial'|'failed'; success?:boolean|null; files: UploadFile[]; archive?: UploadFile };

export class UploadRejected extends Error {
  constructor(public report:UploadReport){super('Invalid upload');}
}

/** Stores incoming bytes separately from the catalog until a storage worker confirms delivery. */
export class Uploads {
  private db: DatabaseSync;
  private active=false;
  constructor(path: string, private root: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS music_uploads (id TEXT PRIMARY KEY, owner TEXT NOT NULL, created_at TEXT NOT NULL, report TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS music_uploads_owner ON music_uploads(owner,created_at DESC);`);
  }
  close() { this.db.close(); }
  async recover() {
    await mkdir(this.root,{recursive:true,mode:0o700});
    for(const entry of await readdir(this.root,{withFileTypes:true})) {
      if(!entry.isDirectory()||!z.uuid().safeParse(entry.name).success)continue;
      if(this.get(entry.name)?.status!=='staged')await rm(join(this.root,entry.name),{recursive:true,force:true});
    }
  }
  list(owner: string) {
    return (this.db.prepare('SELECT report FROM music_uploads WHERE owner=? ORDER BY created_at DESC,id DESC LIMIT 100').all(owner) as {report:string}[]).map(row => JSON.parse(row.report) as UploadReport);
  }
  owned(owner:string,id:string) {
    if(!this.db.prepare('SELECT 1 FROM music_uploads WHERE id=? AND owner=?').get(id,owner))return undefined;
    return this.get(id);
  }
  get(id:string) {
    const row=this.db.prepare('SELECT report FROM music_uploads WHERE id=?').get(id) as {report:string}|undefined;
    return row ? JSON.parse(row.report) as UploadReport : undefined;
  }
  next() {
    const row=this.db.prepare("SELECT report FROM music_uploads WHERE json_extract(report,'$.status')='staged' ORDER BY created_at,id LIMIT 1").get() as {report:string}|undefined;
    return row ? JSON.parse(row.report) as UploadReport : null;
  }
  file(id:string,index:number) {
    const report=this.get(id);
    if(!report||report.status!=='staged'||!Number.isInteger(index)||index<0||index>=report.files.length||report.files[index].status!=='staged')return undefined;
    return {path:join(this.root,id,report.kind==='archive'?`entry-${index}`:String(index)),file:report.files[index]};
  }
  async complete(id:string, raw:unknown, store:CatalogStore) {
    const report=this.get(id);if(!report)throw new Error('Upload not found');
    if(report.status!=='staged')return report;
    const result=z.array(z.discriminatedUnion('ok',[
      z.object({ok:z.literal(true),index:z.number().int().nonnegative(),track:trackSchema}).strict(),
      z.object({ok:z.literal(false),index:z.number().int().nonnegative(),error:z.enum(['invalid_audio','storage_failed','unsupported_file'])}).strict(),
    ])).min(1).max(maxFiles).parse(raw);
    if(result.length!==report.files.length||new Set(result.map(item=>item.index)).size!==report.files.length||result.some(item=>item.index>=report.files.length))throw new Error('Incomplete storage result');
    for(const item of result) {
      const file=report.files[item.index];
      if(item.ok && (item.track.status!=='ready'||!item.track.file||item.track.file.sha256!==file.sha256||item.track.file.sizeBytes!==file.sizeBytes))throw new Error('Storage hash mismatch');
    }
    for(const item of result) {
      const file=report.files[item.index];
      if(item.ok){file.trackId=store.registerFile({...item.track,id:`sha256:${file.sha256}`});file.status='ready';file.success=true;}
      else {file.status='failed';file.success=false;file.error=item.error;}
    }
    const ready=report.files.filter(file=>file.status==='ready').length;
    report.success=ready===report.files.length;
    report.status=ready===report.files.length?'complete':ready?'partial':'failed';
    this.db.prepare('UPDATE music_uploads SET report=? WHERE id=?').run(JSON.stringify(report),id);
    await rm(join(this.root,id),{recursive:true,force:true});
    return report;
  }
  async receive(request: Request, owner: string): Promise<UploadReport> {
    if(this.active)throw new Error('Another upload is being received');
    this.active=true;
    const id = randomUUID(), dir = join(this.root,id), files: UploadFile[] = [];
    let total = 0, error: Error | undefined;
    const pending: Promise<void>[] = [];
    try {
      await mkdir(this.root,{recursive:true,mode:0o700});
      const disk=await statfs(this.root);
      if(disk.bavail*disk.bsize<1536*1024*1024)throw new Error('Insufficient staging space');
      await mkdir(dir,{recursive:true,mode:0o700});
      const parser = busboy({headers:request.headers, preservePath:true, limits:{files:maxFiles,fields:0,parts:maxFiles,fileSize:maxFileBytes}});
      parser.on('filesLimit',()=>{error ??= new Error('Too many files');});
      parser.on('fieldsLimit',()=>{error ??= new Error('Unexpected form field');});
      parser.on('partsLimit',()=>{error ??= new Error('Too many form parts');});
      parser.on('file',(field,stream,info)=>{
        const index=pending.length;
        const name=info.filename ?? '';
        if(field!=='files' || !name || name!==basename(name) || /[\u0000-\u001f\u007f\\/]/u.test(name) || name.length>255 || !(audio.has(extname(name).toLowerCase()) || extname(name).toLowerCase()==='.zip')) error ??= new Error('Unsupported file name or type');
        const hash=createHash('sha256'); let size=0,truncated=false;
        const counter=new Transform({transform(chunk:Buffer,_encoding,done){size+=chunk.length;total+=chunk.length;if(total>maxTotalBytes) { error ??= new Error('Upload is too large'); parser.destroy(error); done(error); return; } hash.update(chunk);done(null,chunk);}});
        stream.on('limit',()=>{truncated=true;error ??= new Error('File is too large');});
        const promise=pipeline(stream,counter,createWriteStream(join(dir,String(index)),{flags:'wx',mode:0o600})).then(()=>{
          if(!size) error ??= new Error('Empty file');
          if(truncated)return;
          files[index]={name,sha256:hash.digest('hex'),sizeBytes:size,status:'staged'};
        }).catch((cause:unknown)=>{error ??= cause instanceof Error ? cause : new Error('Upload failed');});
        pending.push(promise);
      });
      await new Promise<void>((resolve,reject)=>{parser.once('error',cause=>{request.unpipe(parser);request.resume();reject(cause);});request.once('aborted',()=>{parser.destroy(new Error('Upload interrupted'));});parser.once('close',resolve);request.pipe(parser);});
      await Promise.all(pending);
      if(error) throw error;
      if(!files.length) throw new Error('Select at least one file');
      const archives=files.filter(file=>extname(file.name).toLowerCase()==='.zip');
      if(archives.length && (archives.length!==1 || files.length!==1)) throw new Error('Upload one ZIP archive or a set of audio files');
      const archive=archives[0];
      const contents:UploadFile[]=archive ? await unpackArchive(join(dir,'0'),dir) : files;
      if(archive){archive.status='ready';archive.success=true;}
      for(const file of contents)file.success=file.status==='failed'?false:null;
      const report: UploadReport={id,createdAt:new Date().toISOString(),kind:archive?'archive':'files',success:contents.some(file=>file.status==='staged')?null:false,status:contents.some(file=>file.status==='staged')?'staged':'failed',files:contents,...(archive?{archive}:{})};
      this.db.prepare('INSERT INTO music_uploads(id,owner,created_at,report) VALUES(?,?,?,?)').run(id,owner,report.createdAt,JSON.stringify(report));
      if(report.status==='failed')await rm(dir,{recursive:true,force:true});
      return report;
    } catch (cause) {
      await Promise.allSettled(pending);
      await rm(dir,{recursive:true,force:true});
      const received=files.filter(Boolean).map(file=>({...file,status:'failed' as const,success:false,error:'invalid_upload'}));
      if(received.length&&!request.aborted) {
        const archive=received.length===1&&extname(received[0].name).toLowerCase()==='.zip'?received[0]:undefined;
        const report:UploadReport={id,createdAt:new Date().toISOString(),kind:archive?'archive':'files',status:'failed',success:false,files:archive?[]:received,...(archive?{archive}:{})};
        this.db.prepare('INSERT INTO music_uploads(id,owner,created_at,report) VALUES(?,?,?,?)').run(id,owner,report.createdAt,JSON.stringify(report));
        throw new UploadRejected(report);
      }
      throw cause;
    } finally {this.active=false;}
  }
}

