// Actual Pi-loader acceptance for generated edition packages. No model/session access.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const [directory]=process.argv.slice(2),host=process.env.PI_HOST_ROOT;
if(!directory||!host)throw new Error('Usage: PI_HOST_ROOT=<host> node scripts/verify-editions.mjs <generated-packages>');
const loader=await import(pathToFileURL(path.join(host,'dist/core/extensions/loader.js')));
const bundle=process.env.PI_BUNDLED_LOADER==='1'?await import(pathToFileURL(path.join(host,'dist/bundle/index.js'))):undefined;
const {createEventBus}=await import(pathToFileURL(path.join(host,'dist/core/event-bus.js')));
const {getThemeByName,setThemeInstance}=await import(pathToFileURL(path.join(host,'dist/modes/interactive/theme/theme.js')));
const theme=getThemeByName('dark');setThemeInstance(theme);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,label){const end=Date.now()+10000;while(!await check()){assert.ok(Date.now()<end,label);await sleep(10);}}
const strip=s=>s.replace(/\x1b\[[0-9;]*m/g,'');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifests={};
for(const edition of ['ts','python','rust']){
 const dir=path.join(directory,'pitools-'+edition),m=JSON.parse(fs.readFileSync(path.join(dir,'distribution.json')));manifests[edition]=m;
 assert.equal(m.edition,edition);for(const [file,digest]of Object.entries(m.files))assert.equal(hash(fs.readFileSync(path.join(dir,file))),digest,file);
 const entry=path.join(dir,'index.ts');
 const saved={PITOOLS_CORE:process.env.PITOOLS_CORE,PITOOLS_RUST_CORE:process.env.PITOOLS_RUST_CORE};
 process.env.PITOOLS_CORE=edition==='ts'?'rust':'ts';delete process.env.PITOOLS_RUST_CORE;
 let loaded,self;
 try{
  loaded=bundle?await bundle.discoverAndLoadExtensions([entry],directory,path.join(directory,'isolated-agent')):await loader.loadExtensions([entry],directory);
  assert.deepEqual(loaded.errors,[]);const ext=loaded.extensions[0];loaded.runtime.appendEntry=()=>{};loaded.runtime.getAllTools=()=>[];
  const notes=[],tui={terminal:{rows:30},requestRender(){}};let widget;
  const ctx={mode:'tui',hasUI:true,sessionManager:{getBranch(){return[];}},ui:{notify(text,level){notes.push({text,level});},setWidget(_name,factory){widget=factory?.(tui,theme);},custom(){return Promise.resolve();}}};
  const emit=async(name,event={})=>{for(const fn of ext.handlers.get(name)??[])await fn(event,ctx);};
  const command=args=>ext.commands.get('pitools').handler(args,ctx);
  const status=async()=>{await command('core status');return notes.at(-1).text;};
  self={emit};await emit('session_start');
  await until(async()=>{const s=await status();return s.includes('实际 '+(edition==='ts'?'TS':edition==='python'?'Python':'Rust'))&&!s.includes('启动中');},'default edition worker startup');
  await until(()=>strip(widget.render(160)[0]).includes('待机中'),'ready idle view');
  const selected=await status();const pid=Number(/worker pid (\d+)/.exec(selected)?.[1]??0);
  assert.equal(pid>0,edition!=='ts');
  for(const other of ['python','rust'].filter(x=>x!==edition)){await command('core '+other);assert.ok(notes.at(-1).text.includes('独立包'));assert.equal(/worker pid (\d+)/.exec(await status())?.[1],pid?String(pid):undefined);}
  await emit('agent_start');const message={role:'assistant',content:[{type:'text',text:'⏵ 同一界面验收\ud800'}],usage:{output:1500},stopReason:'stop'};
  await emit('message_start',{message});await emit('message_update',{message,assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:message.content[0].text}});
  await until(()=>strip(widget.render(160)[0]).includes('同一界面验收'),'edition narration');
  await emit('tool_execution_start',{toolCallId:'p1',toolName:'read',args:{path:'中文'}});await emit('tool_execution_start',{toolCallId:'p2',toolName:'bash',args:{command:'synthetic'}});
  await until(()=>strip(widget.render(160)[0]).includes('2 并行'),'parallel tools');
  for(const id of ['p1','p2'])await emit('tool_execution_end',{toolCallId:id,toolName:'read',result:{content:[{type:'text',text:'complete'}]},isError:false});
  await emit('message_end',{message});await emit('agent_end',{messages:[message]});
  await until(()=>strip(widget.render(160)[0]).includes('1.5k tokens'),'completion usage');
  assert.ok(widget.render(160)[0].startsWith(theme.fg('success','●')));
  await command('version');assert.ok(notes.at(-1).text.includes('包类型 '+edition));
  await emit('session_shutdown');await emit('session_shutdown');if(pid)await until(()=>{try{process.kill(pid,0);return false;}catch{return true;}},'worker exit');
  assert.ok(!notes.some(n=>n.level==='warning'&&!n.text.includes('独立包')),JSON.stringify(notes));
  console.log('PASS: '+edition+' product; fixed default despite conflicting env, packaged binary, shared UI, full tool pairing, usage, rejection of foreign backend, shutdown');
 }finally{
  await self?.emit('session_shutdown');loaded?.runtime.invalidate();
  for(const[k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;
 }
}
assert.equal(manifests.ts.uiSha256,manifests.python.uiSha256);assert.equal(manifests.ts.uiSha256,manifests.rust.uiSha256);
// A single shared host bus/runtime must reject the second package, then release
// its claim on runtime invalidation so a reload can choose another edition.
const bus=createEventBus();
const first=await loader.loadExtensions(['ts','python','rust'].map(x=>path.join(directory,'pitools-'+x,'index.ts')),directory,bus);
assert.equal(first.extensions.length,1);assert.equal(first.errors.length,2);assert.ok(first.errors.every(e=>e.error.includes('三包只选一个')));
first.runtime.invalidate();
const next=await loader.loadExtensions([path.join(directory,'pitools-python/index.ts')],directory,bus);assert.deepEqual(next.errors,[]);next.runtime.invalidate();
console.log('PASS: identical UI hashes, mutually exclusive packages and clean reload ownership');
