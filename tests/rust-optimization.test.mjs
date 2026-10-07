process.env.TZ='UTC';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ActivityCore,RustWorker,resolveRust} from '../python-core.ts';
const rust=resolveRust(), native={skip:rust?false:'set PITOOLS_RUST_CORE to the explicitly built binary'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function capture(compact=true){
 const writes=[],errors=[],worker=new RustWorker(()=>{},e=>errors.push(e));
 worker.compactDeltas=compact;worker.batchEvents=true;
 worker.child={removeAllListeners(){},kill(){},stdin:{writableLength:0,write:s=>writes.push(s),end(){},removeAllListeners(){},on(){}}};
 return {worker,writes,errors};
}
const frame=i=>({type:'event',op:'delta',epoch:1,seq:i,now:1700000000000+i,local:[2026,4,17,5,12],kind:'text_delta',text:'⏵ \ud800'+ 'a'.repeat(290)});
const expand=f=>f.type==='delta_pack'?f.groups.flatMap(g=>g.rows.map(([seq,now,index])=>({type:'event',op:'delta',epoch:g.epoch,seq,now,local:g.local,kind:g.kind,text:g.texts[index]}))):f.type==='event_batch'?f.events:[f];

test('static Rust tables regenerate exactly from licensed JSON, including ordered rules and FE0E',()=>{
 const out=execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/gen-rust-assets.mjs',import.meta.url)),'--check'],{encoding:'utf8'});assert.ok(out.includes('PASS'));
});

test('compact groups preserve every delta/UTF-16 unit/clock, share repeated text, bound count and bytes',()=>{
 const {worker,writes,errors}=capture();const original=[];
 try{
  for(let i=1;i<=1600;i++){
   const f=frame(i);if(i%67===0){f.kind='thinking_delta';f.local=[2026,4,18,6,0];f.epoch=2;f.text='\udfff';}
   original.push(structuredClone(f));worker.write(f);f.local[0]=1900;
  }
  worker.write({type:'event',op:'finish',epoch:2,seq:1601,now:1700000009000,local:[2026,4,18,6,0],reason:''});worker.flush();
  const lines=writes.join('').trim().split('\n'),wire=lines.map(JSON.parse);
  assert.deepEqual(wire.flatMap(expand).slice(0,1600),original);
  for(let i=0;i<wire.length;i++)if(wire[i].type==='delta_pack'){
   assert.ok(Buffer.byteLength(lines[i])<=65536);assert.ok(wire[i].groups.reduce((n,g)=>n+g.rows.length,0)<=64);
  }
  assert.ok(wire.filter(f=>f.type==='delta_pack').length<30);
  assert.ok(Buffer.byteLength(writes.join(''))<160000,'no 1600 duplicate 300-unit strings on the pipe');
  assert.equal(wire.at(-1).op,'finish');assert.deepEqual(errors,[]);assert.equal(worker.packIndex.size,0);
 }finally{worker.stop();}
});

test('compact singleton deadline remains a legacy event; feature-less workers retain legacy batches',async()=>{
 const a=capture(),b=capture(false);
 try{
  a.worker.write(frame(1));await sleep(30);a.worker.flush();assert.equal(JSON.parse(a.writes[0]).type,'event');
  a.worker.write(frame(2));a.worker.stop();assert.equal(a.worker.deltaCount,0);assert.equal(a.worker.packIndex.size,0);assert.equal(a.worker.batchTimer,undefined);
  b.worker.write(frame(1));b.worker.write(frame(2));b.worker.flushDeltas();b.worker.flush();assert.equal(JSON.parse(b.writes[0]).type,'event_batch');
 }finally{a.worker.stop();b.worker.stop();}
});

test('heterogeneous unique compact texts flush on conservative UTF-8 budget without losing fields',()=>{
 const {worker,writes}=capture();const frames=[];
 try{
  for(let i=1;i<=100;i++){const f=frame(i);f.text=String.fromCharCode(0xd800+i).repeat(301);frames.push(f);worker.write(f);}
  worker.flushDeltas();worker.flush();const wire=writes.join('').trim().split('\n');
  assert.ok(wire.length>1);for(const line of wire)assert.ok(Buffer.byteLength(line)<=65536);
  assert.deepEqual(wire.map(JSON.parse).flatMap(expand),frames);
 }finally{worker.stop();}
});

test('real compact Rust batches retain ordered events and match TS with repeated/lone-unit text',native,async()=>{
 const core=new ActivityCore({onChange(){},onFallback(){},resolveRust:()=>rust,verify:true});
 const now=Date.now();
 try{
  assert.equal(await core.useRust(),undefined);assert.equal(core.worker.compactDeltas,true);
  core.begin(now);
  for(let i=0;i<1000;i++)core.delta(i%113?'text_delta':'thinking_delta',i%83?'⏵ 逐个保留\ud800':'\udfff',now+i);
  core.messageEnd({content:[{type:'text',text:'⏵ 最终\udfff'}],usage:{output:1500}},now+1001);
  core.finish(now+3000);core.requestView(now+3000);
  const end=Date.now()+8000;
  while(core.worker?.requests.size||core.worker?.pending||core.worker?.deltas.length||core.viewTimer||core.viewQueued||core.inFlight){assert.ok(core.rust_active,core.failure);assert.ok(Date.now()<end);await sleep(5);}
  assert.equal(core.mismatches,0);assert.ok(core.matches>0);assert.equal(core.line(now+3000),core.ts.line(now+3000));assert.ok(core.readyForPaint);
 }finally{core.dispose();}
});

test('paint freshness follows the queued query sequence, avoids duplicate in-flight queries and clears on switch',()=>{
 const core=new ActivityCore({onChange(){},onFallback(){},paintDeadline:()=>Date.now()+100000});
 const requests=[];
 core.requested='rust';core.worker={closed:false,write(){return true;},request:p=>requests.push(p),stop(){this.closed=true;}};
 core.queueView=()=>{};core.epoch=1;
 core.begin(1000);const first=core.requestView(1000);core.inFlight=first;
 assert.equal(core.readyForPaint,false);core.requestPaintView();assert.equal(requests.length,1);
 core.delta('text_delta','⏵ 最新',1001);
 core.accept({epoch:1,id:first,line:'old',phase:'waiting',failure:false,live:true});assert.equal(core.readyForPaint,true);
 core.completePaint();assert.equal(core.readyForPaint,false);
 const second=core.requestView(1001);core.accept({epoch:1,id:second,line:core.ts.line(1001),phase:'thinking',failure:false,live:true});assert.equal(core.readyForPaint,true);
 core.useTs();assert.equal(core.readyForPaint,true);assert.equal(core.queries.size,0);
});

test('a fast stream cannot keep moving the pending paint frontier; critical events still advance it',()=>{
 const core=new ActivityCore({onChange(){},onFallback(){}});
 core.requested='rust';core.worker={closed:false,write(){return true;},request(){},stop(){this.closed=true;}};core.queueView=()=>{};
 core.epoch=1;core.begin(1000);core.requestPaintView();const id=core.requestView(1000);
 for(let i=0;i<1000;i++)core.delta('text_delta','⏵ 持续输入',1001+i);
 core.requestPaintView();assert.equal(core.paintTarget,1);
 core.accept({epoch:1,id,line:'frame at frontier',phase:'waiting',failure:false,live:true});assert.equal(core.readyForPaint,true);
 core.completePaint();assert.equal(core.readyForPaint,false);
 core.requestPaintView();const id2=core.requestView(2001);core.toolStart('full-id','read',{path:'a'},2002);
 assert.equal(core.paintTarget,core.seq);
 core.accept({epoch:1,id:id2,line:'pre-tool',phase:'thinking',failure:false,live:true});assert.equal(core.readyForPaint,false);
 const id3=core.requestView(2003);core.accept({epoch:1,id:id3,line:core.ts.line(2003),phase:'tool',failure:false,live:true});assert.equal(core.readyForPaint,true);
 core.dispose();assert.equal(core.paintTarget,undefined);
});

test('stream followup observes the deadline advanced by the just-completed paint',()=>{
 let deadline=Date.now()-1;
 const core=new ActivityCore({onFallback(){},paintDeadline:()=>deadline,onChange(){core.completePaint();deadline=Date.now()+120;}});
 core.requested='rust';core.worker={closed:false,request(){},stop(){this.closed=true;}};core.epoch=1;
 const id=core.requestView(Date.now());core.inFlight=id;core.dirty='stream';
 core.accept({epoch:1,id,line:'current',phase:'thinking',failure:false,live:true});
 assert.equal(core.viewQueued,false);assert.ok(core.viewTimer);core.dispose();
});

test('stream query deadline uses the shared paint clock, not an extra fixed interval',()=>{
 const core=new ActivityCore({onChange(){},onFallback(){},paintDeadline:()=>Date.now()-1});
 core.requested='rust';core.worker={closed:false,stop(){this.closed=true;}};core.scheduledView=()=>{};
 core.lastViewAt=Date.now();core.queueView(false);
 assert.equal(core.viewQueued,true);assert.equal(core.viewTimer,undefined);core.dispose();
});
