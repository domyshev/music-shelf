import {createRequire} from 'node:module';
import {readFileSync,existsSync,mkdirSync,cpSync} from 'node:fs';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const project=fileURLToPath(new URL('../../',import.meta.url));
if(!process.argv[2])throw new Error('Supply a new destination directory');
const output=resolve(process.argv[2]);
mkdirSync(output,{recursive:false});
cpSync(join(project,'dist/runtime'),join(output,'dist/runtime'),{recursive:true});
cpSync(join(project,'storage'),join(output,'storage'),{recursive:true});
for(const file of ['server.mjs','client.mjs','run.py'])cpSync(join(project,'tests/storage-e2e',file),join(output,file));
cpSync(join(project,'package.json'),join(output,'package.json'));
const seen=new Set();
function copy(name,from){
 const req=createRequire(join(from,'package.json'));
 const dir=req.resolve.paths(name).map(base=>join(base,name)).find(p=>existsSync(join(p,'package.json')));
 if(!dir)throw new Error('Missing dependency: '+name);
 if(seen.has(dir))return;
 seen.add(dir);
 const location=relative(join(project,'node_modules'),dir);
 if(location.startsWith('..'))throw new Error('Dependency is outside project');
 const destination=join(output,'node_modules',location);
 mkdirSync(dirname(destination),{recursive:true});cpSync(dir,destination,{recursive:true});
 for(const dep of Object.keys(JSON.parse(readFileSync(join(dir,'package.json'))).dependencies??{}))copy(dep,dir);
}
for(const dep of ['express','zod','busboy','yauzl'])copy(dep,project);
console.log('Isolated runtime bundle:',output);
