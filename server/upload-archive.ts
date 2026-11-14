import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { extname, join } from 'node:path';
import { Transform, Writable } from 'node:stream';
import { crc32 } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import * as yauzl from 'yauzl';

const audio = new Set(['.flac','.mp3','.m4a','.aac','.ogg','.opus','.wav','.aiff','.aif']);
const maxFile = 512 * 1024 * 1024, maxTotal = 1024 * 1024 * 1024, maxEntries = 200;
export interface ArchiveFile { name:string; sha256:string; sizeBytes:number; status:'staged'|'failed';error?:string }

/** Extract only regular audio files to numbered files, never to archive-supplied paths. */
export async function unpackArchive(path:string, dir:string):Promise<ArchiveFile[]> {
  const zip = await new Promise<yauzl.ZipFile>((resolve,reject)=>yauzl.open(path,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(error,file)=>error || !file ? reject(error ?? new Error('Invalid ZIP')) : resolve(file)));
  const files:ArchiveFile[]=[];let total=0, entries=0;const names=new Set<string>();
  try {
    await new Promise<void>((resolve,reject)=>{
      let settled=false;
      const fail=(error:unknown)=>{if(!settled){settled=true;reject(error);}};
      zip.on('error',fail);
      zip.on('end',()=>{if(!settled){settled=true;resolve();}});
      zip.on('entry',(entry:yauzl.Entry)=>{
        void (async()=>{
          if(++entries>maxEntries) throw new Error('Too many archive entries');
          const name=entry.fileName;
          if(!name || name.length>1024 || /[\u0000-\u001f\u007f\\]/u.test(name) || name.startsWith('/') || name.split('/').some(part=>part==='..'||part==='.') || /^[A-Za-z]:/.test(name)) throw new Error('Unsafe archive path');
          const type=(entry.externalFileAttributes >>> 16) & 0o170000;
          if(type && type!==0o100000 && type!==0o040000) throw new Error('Unsupported archive entry');
          if(name.endsWith('/')) {zip.readEntry();return;}
          const supported=audio.has(extname(name).toLowerCase());
          if(entry.generalPurposeBitFlag & 1) throw new Error('Encrypted archives are not supported');
          if(entry.uncompressedSize<0 || entry.uncompressedSize>maxFile || total+entry.uncompressedSize>maxTotal) throw new Error('Archive is too large');
          const normalized=name.normalize('NFC');if(names.has(normalized))throw new Error('Duplicate archive path');names.add(normalized);
          const stream=await new Promise<NodeJS.ReadableStream>((res,rej)=>zip.openReadStream(entry,(error,input)=>error||!input?rej(error??new Error('Invalid entry')):res(input)));
          const hash=createHash('sha256');let size=0,crc=0;
          const meter=new Transform({transform(chunk:Buffer,_encoding,done){size+=chunk.length;if(size>maxFile||total+size>maxTotal){done(new Error('Archive is too large'));return;}hash.update(chunk);crc=crc32(chunk,crc);done(null,chunk);}});
          await pipeline(stream,meter,supported ? createWriteStream(join(dir,`entry-${files.length}`),{flags:'wx',mode:0o600}) : new Writable({write(_chunk,_encoding,done){done();}}));
          if(crc!==entry.crc32)throw new Error('Archive checksum mismatch');
          total+=size;files.push({name:normalized,sha256:hash.digest('hex'),sizeBytes:size,status:supported&&size>0?'staged':'failed',...(!supported||size===0?{error:'unsupported_file'}:{})});zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
    if(!files.length)throw new Error('Archive has no audio files');
    return files;
  } finally { zip.close(); }
}
