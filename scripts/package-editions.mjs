// Explicit allowlisted packaging, never run by a plugin/install hook.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {editionReadme} from '../packaging/readme.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2), arg=k=>args.includes(k)?args[args.indexOf(k)+1]:undefined;
const output=arg('--out');if(!output||!path.isAbsolute(output))throw new Error('--out must be an explicit absolute directory');
const editions=(arg('--only')??'ts,python,rust').split(',');
if(new Set(editions).size!==editions.length||editions.some(x=>!['ts','python','rust'].includes(x)))throw new Error('invalid editions');
const native=arg('--native'),required=(arg('--require-targets')??'x86_64-pc-windows-msvc,aarch64-apple-darwin,x86_64-apple-darwin,x86_64-unknown-linux-gnu').split(',');
const allowed=new Set(['x86_64-pc-windows-msvc','aarch64-apple-darwin','x86_64-apple-darwin','x86_64-unknown-linux-gnu']);
if(required.some(t=>!allowed.has(t)))throw new Error('unsupported target');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const artifacts=[];
if(editions.includes('rust')){
 if(!native||!path.isAbsolute(native))throw new Error('Rust edition requires explicit native artifacts, not user compilation');
 for(const target of required){
  const dir=path.join(native,target),info=JSON.parse(fs.readFileSync(path.join(dir,'build-info.json'),'utf8'));
  const name=target.includes('windows')?'pitools-core.exe':'pitools-core';
  if(info.version!==pkg.version||info.target!==target||info.sourceCommit!==sourceCommit||info.nodeUnicode!=='16.0')throw new Error('native artifact/source mismatch: '+target);
  if(info.sourceDirty&&!args.includes('--allow-dirty-native'))throw new Error('dirty native artifact is local-test-only');
  if(hash(fs.readFileSync(path.join(dir,name)))!==info.binarySha256)throw new Error('native binary hash mismatch');
  if(!Object.keys(info.licenses??{}).length)throw new Error('native licensing missing');
  if(target==='x86_64-unknown-linux-gnu'&&!/^\d+\.\d+(?:\.\d+)?$/.test(info.platformRequirements?.glibcMin??''))throw new Error('GNU libc requirement missing');
  for(const [file,digest]of Object.entries(info.licenses)){
   if(!file.startsWith('licenses/')||file.includes('..')||path.isAbsolute(file)||file.includes('\\'))throw new Error('unsafe license path');
   if(hash(fs.readFileSync(path.join(dir,file)))!==digest)throw new Error('license hash mismatch');
  }
  artifacts.push({target,dir,info,name});
 }
}
for(const edition of editions)if(fs.existsSync(path.join(output,'pitools-'+edition)))throw new Error('Refuse overwriting an edition package');
fs.mkdirSync(output,{recursive:true});
const common=['core.ts','rendering.ts','activity.ts','data/activity/data.ts','data/activity/frames.json','data/activity/phrases.json','data/activity/LICENSE','LICENSE','THIRD_PARTY_NOTICES.md'];
const python=['python/pitools_worker.py','python/pitools_core/__init__.py','python/pitools_core/activity.py'];
for(const edition of editions){
 const out=path.join(output,'pitools-'+edition);fs.mkdirSync(out);
 const write=(rel,data)=>{const f=path.join(out,rel);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,data);};
 const copy=(rel,source=rel)=>write(rel,fs.readFileSync(path.join(root,source),'utf8').replace(/\r\n/g,'\n'));
 for(const file of common)copy(file);
 copy('ui.ts','index.ts');
 copy('python-core.ts',edition==='ts'?'packaging/ts-core.ts':'python-core.ts');
 if(edition==='python')for(const file of python)copy(file);
 if(edition==='rust')for(const a of artifacts){
  const base='bin/'+a.target+'/';write(base+a.name,fs.readFileSync(path.join(a.dir,a.name)));
  if(!a.target.includes('windows'))fs.chmodSync(path.join(out,base+a.name),0o755);
  write(base+'build-info.json',JSON.stringify(a.info,null,2)+'\n');
  for(const file of Object.keys(a.info.licenses))write(base+file,fs.readFileSync(path.join(a.dir,file)));
 }
 write('index.ts',`// Generated independent ${edition} edition; UI source is identical in all packages.\nimport pitools from './ui.ts';\nexport default function(pi: any) { return pitools(pi, { edition: '${edition}' }); }\n`);
 const name='pitools-'+edition;
 write('package.json',JSON.stringify({name,version:pkg.version,private:true,type:'module',description:`Pi terminal trajectory inspector — ${edition.toUpperCase()} activity edition`,license:pkg.license,repository:{type:'git',url:`https://github.com/ZSY007/${name}.git`},homepage:`https://github.com/ZSY007/${name}`,keywords:['pi-package'],pi:{extensions:['./index.ts']},peerDependencies:pkg.peerDependencies,engines:pkg.engines},null,2)+'\n');
 write('.gitignore','node_modules/\n__pycache__/\n*.pyc\n.pi/\n');
 write('.gitattributes','* text=auto eol=lf\nbin/** -text\n');
 write('README.md',editionReadme({edition,version:pkg.version,rustTargets:artifacts.map(a=>a.target),glibcMin:artifacts.find(a=>a.target==='x86_64-unknown-linux-gnu')?.info.platformRequirements.glibcMin}));
 const digests={};
 function walk(dir,base=''){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const rel=base+e.name;if(e.isDirectory())walk(path.join(dir,e.name),rel+'/');else digests[rel]=hash(fs.readFileSync(path.join(dir,e.name)));}}
 walk(out);write('distribution.json',JSON.stringify({schema:1,edition,version:pkg.version,sourceCommit,rustTargets:edition==='rust'?artifacts.map(a=>a.target):[],uiSha256:hash(fs.readFileSync(path.join(out,'ui.ts'))),files:digests},null,2)+'\n');
 console.log(`PACKAGED ${name} ${pkg.version}; ${Object.keys(digests).length} allowlisted files`);
}
