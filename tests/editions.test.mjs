process.env.TZ='UTC';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {ActivityCore as DevelopmentCore} from '../python-core.ts';
import {drive} from './activity-scenarios.mjs';
const build=fileURLToPath(new URL('../scripts/package-editions.mjs',import.meta.url));
function packages(){const out=fs.mkdtempSync(path.join(os.tmpdir(),'pitools-editions-'));execFileSync(process.execPath,[build,'--out',out,'--only','ts,python']);return out;}
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');

test('TS/Python packages are independent allowlisted products with byte-identical common UI',()=>{
 const out=packages();
 try{
  const a=path.join(out,'pitools-ts'),b=path.join(out,'pitools-python');
  for(const root of [a,b]){
   const m=JSON.parse(fs.readFileSync(path.join(root,'distribution.json')));
   for(const [file,digest]of Object.entries(m.files))assert.equal(hash(fs.readFileSync(path.join(root,file))),digest,file);
   assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'))).name,'pitools-'+m.edition);
   assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'package.json'))).pi.extensions,['./index.ts']);
   assert.ok(fs.readFileSync(path.join(root,'index.ts'),'utf8').includes(`edition: '${m.edition}'`));
   for(const forbidden of ['.pi','auth.json','models.json','tests','rust','target','node_modules','scripts'])assert.equal(fs.existsSync(path.join(root,forbidden)),false,forbidden);
  }
  for(const file of ['ui.ts','core.ts','rendering.ts','activity.ts','data/activity/data.ts'])assert.deepEqual(fs.readFileSync(path.join(a,file)),fs.readFileSync(path.join(b,file)));
  assert.equal(fs.existsSync(path.join(a,'python')),false);assert.equal(fs.existsSync(path.join(a,'bin')),false);
  assert.ok(!/from ['"]node:child_process|spawn\(|PITOOLS_RUST_CORE/.test(fs.readFileSync(path.join(a,'python-core.ts'),'utf8')));
  assert.ok(fs.existsSync(path.join(b,'python/pitools_worker.py')));assert.equal(fs.existsSync(path.join(b,'bin')),false);
 }finally{fs.rmSync(out,{recursive:true,force:true});}
});

test('pure TS edition facade matches the real default facade over deterministic full event streams',async()=>{
 const out=packages();let views=0;
 try{
  const {ActivityCore}=await import(pathToFileURL(path.join(out,'pitools-ts/python-core.ts')));
  for(let seed=0;seed<40;seed++){
   const a=new ActivityCore({onChange(){}}),b=new DevelopmentCore({onChange(){},onFallback(){}});
   const expected=[];
   b.requestView=now=>expected.push([b.line(now),b.phase,b.failed,b.live,b.nextWakeAt(now)]);
   drive(b,seed,60);a.requestView=now=>{assert.deepEqual([a.line(now),a.phase,a.failed,a.live,a.nextWakeAt(now)],expected.shift());views++;};
   drive(a,seed,60);assert.equal(expected.length,0);assert.equal(a.worker_active,false);a.dispose();b.dispose();
  }
  assert.ok(views>3000);
 }finally{fs.rmSync(out,{recursive:true,force:true});}
});

test('Rust product cannot be emitted as a source-only or mismatched placeholder package',()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'pitools-rust-package-'));
 try{assert.throws(()=>execFileSync(process.execPath,[build,'--out',out,'--only','rust'],{stdio:'pipe'}));assert.equal(fs.existsSync(path.join(out,'pitools-rust')),false);}
 finally{fs.rmSync(out,{recursive:true,force:true});}
});
