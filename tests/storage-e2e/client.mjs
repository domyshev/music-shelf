import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {crc32} from 'node:zlib';
import {readFileSync,writeFileSync} from 'node:fs';
const token=readFileSync('/data/test-token','utf8');
const wave=Buffer.alloc(2044);wave.write('RIFF',0);wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(8000,24);wave.writeUInt32LE(16000,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(2000,40);randomBytes(16).copy(wave,wave.length-16);
const checksum=createHash('sha256').update(wave).digest('hex');
function zip(bytes,name){const n=Buffer.from(name),h=Buffer.alloc(30),c=Buffer.alloc(46),e=Buffer.alloc(22);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt32LE(crc32(bytes),14);h.writeUInt32LE(bytes.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(n.length,26);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc32(bytes),16);c.writeUInt32LE(bytes.length,20);c.writeUInt32LE(bytes.length,24);c.writeUInt16LE(n.length,28);e.writeUInt32LE(0x06054b50);e.writeUInt16LE(1,8);e.writeUInt16LE(1,10);e.writeUInt32LE(c.length+n.length,12);e.writeUInt32LE(h.length+n.length+bytes.length,16);return Buffer.concat([h,n,bytes,c,n,e]);}
const archive=zip(wave,'Collection/test.wav'),reports=[];
for(const [name,bytes] of [['test.wav',wave],['collection.zip',archive]]) {
 const body=new FormData();body.append('files',new Blob([bytes]),name);
 const response=await fetch('http://127.0.0.1:8080/api/uploads?wait=30',{method:'POST',headers:{Authorization:'Bearer '+token},body});
 const report=await response.json();
 assert.equal(response.status,200,JSON.stringify(report));assert.equal(report.success,true);assert.equal(report.files[0].sha256,checksum);assert.equal(report.files[0].status,'ready');
 if(name.endsWith('.zip')){assert.equal(report.archive.sha256,createHash('sha256').update(archive).digest('hex'));assert.equal(report.files[0].name,'Collection/test.wav');}
 reports.push(report);console.log('Verified',report.kind,report.status);
}
assert.notEqual(reports[0].id,reports[1].id);assert.equal(reports[0].files[0].trackId,reports[1].files[0].trackId);
writeFileSync('/data/verified.json',JSON.stringify({reports,sha256:checksum}),{mode:0o600});
