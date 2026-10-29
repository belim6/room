import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collect } from '../collect/index';
import { collectBackground } from '../collect/background';
import { eventNodeIndex } from '../collect/event-index';
import { config, redact, redactPath, redactDeep } from '../collect/privacy';
import { masking, maskDeep } from '../collect/rooms';
import { createOffice } from '../server';
// @ts-ignore browser model
import { operationTreeNodeEvents, operationGraphWheel, operationGraphZoom, visibleOperationNodes, progressiveOperationGraph, centreOperationGraph, operationGraphPointerHandlers } from '../web/model.mjs';

test('placement index matches the old filter for every node on the real collected events', () => {
  const data=collect(); assert.ok(data.events.length>0); assert.ok(data.operationTree?.nodes.length);
  for(const n of data.operationTree!.nodes) assert.deepEqual(data.eventNodeIndex!.get(n.id),operationTreeNodeEvents(data.events,data.operationTree,n.id),n.id);
  const f=masking(data.allow);
  const oldMask=(v:any,k='',mine=false):any=>{
    if(typeof v==='string')return ['path','source','file'].includes(k)?v:mine?f.own(v):f.full(v);
    if(Array.isArray(v))return v.map(x=>oldMask(x,k,mine));
    if(!v||typeof v!=='object')return v;
    const own=mine||f.isOwn(v.source)||f.isOwn(v.detailRef?.file)||f.isOwn(v.path);
    return Object.fromEntries(Object.entries(v).map(([key,value])=>[key,oldMask(value,key,own)]));
  };
  const sample=data.events.slice(0,1000);
  assert.deepEqual(maskDeep(data.allow)(sample),oldMask(sample),'request-local masking cache preserves scope and output');

});

test('index handles aliases, longest prefixes, ancestors, order and unfiled', () => {
  const tree:any={nodes:[{id:'root',parent:null,aliases:['legacy']},{id:'child',parent:'root',aliases:['legacy/deep']},{id:'unfiled',parent:null}]};
  const events:any=[{id:'1',operation:'legacy/deep/x'},{id:'2',operation:'legacy/x'},{id:'3',operation:'unknown'},{id:'4'}];
  const index=eventNodeIndex(events,tree);
  for(const n of tree.nodes)assert.deepEqual(index.get(n.id),operationTreeNodeEvents(events,tree,n.id));
});

test('node and summary routes serve the last snapshot while a collect is pending, then publish atomically', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'office-background-'));
  try {
    const cfg=config({OFFICE_HOME:dir}); let finish:any,calls=0;
    const office=createOffice(cfg,{collectAsync:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});
    const before=office.data; before.operationTree={nodes:[{id:'root',parent:null}]} as any;
    before.eventNodeIndex=new Map([['root',[]]]);
    const pending=office.live.full(); assert.equal(office.live.full(),pending);assert.equal(calls,1);
    // Exercise the real route handlers without binding a socket (sandbox prohibits listen).
    const request=(url:string)=>{let result:any;const route=(office.app as any)._router.stack.find((s:any)=>s.route?.path===url).route;route.stack[0].handle({query:{id:'root'}},{json:(v:any)=>{result=v;},status:()=>{throw Error('unexpected status');}});return result;};
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(office.data,before);assert.deepEqual(request('/api/events/node').events,[]);
    assert.equal(request('/api/summary').collectedAt,before.collectedAt);
    const next={...before,collectedAt:'2030-01-01T00:00:00.000Z'}; finish(next);await pending;
    assert.equal(request('/api/summary').collectedAt,next.collectedAt);
    office.live.stop();
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('worker snapshot restores allowlist and identity behavior and maps', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'office-worker-'));
  try {const cfg=config({OFFICE_HOME:dir}),data=await collectBackground(cfg);assert.ok(data.byId instanceof Map);assert.ok(data.eventNodeIndex instanceof Map);assert.equal(typeof data.allow.read,'function');assert.equal(typeof data.ident.apply,'function');assert.equal(data.allow.allows('/etc/passwd'),false);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('plain touchpad and mouse wheel pan; ctrl/meta pinch keeps the cursor world point fixed', () => {
  const cam={x:40,y:-10,s:1},point={x:250,y:140};
  assert.deepEqual(operationGraphWheel(cam,{deltaX:12,deltaY:23},point),{x:28,y:-33,s:1});
  assert.deepEqual(operationGraphWheel(cam,{deltaY:2,deltaMode:1},point),{x:40,y:-42,s:1});
  for(const modifier of ['ctrlKey','metaKey']){const next=operationGraphWheel(cam,{deltaY:-100,[modifier]:true},point);assert.ok(next.s>cam.s);assert.ok(Math.abs((point.x-next.x)/next.s-(point.x-cam.x)/cam.s)<1e-9);assert.ok(Math.abs((point.y-next.y)/next.s-(point.y-cam.y)/cam.s)<1e-9);}
  assert.equal(operationGraphZoom(cam,100,point).s,2.5);assert.equal(operationGraphZoom(cam,.001,point).s,.6);
});

const tree={nodes:[{id:'a',parent:null},{id:'b',parent:'a'},{id:'c',parent:'a'},{id:'d',parent:'b'},{id:'z',parent:null},{id:'zz',parent:'z'}]};
test('disclosure starts at roots and retains independent branches and remembered descendant state', () => {
  const ids=(expanded:string[])=>visibleOperationNodes(tree,new Set(expanded)).map((n:any)=>n.id);
  assert.deepEqual(visibleOperationNodes({nodes:[...tree.nodes,{id:'unfiled',parent:null}]},new Set()).map((n:any)=>n.id),['a','z']);
  assert.deepEqual(ids([]),['a','z']);assert.deepEqual(ids(['a']),['a','b','c','z']);assert.deepEqual(ids(['a','b','z']),['a','b','d','c','z','zz']);assert.deepEqual(ids(['b','z']),['a','z','zz']);
});
test('all disclosure combinations have stable positions, no overlapping cards, bounded centred focus', () => {
  const all=progressiveOperationGraph(tree,new Set(['a','b','z']));
  for(const state of [[],['a'],['z'],['a','b'],['a','z'],['a','b','z']]){
    const graph=progressiveOperationGraph(tree,new Set(state));
    for(const n of graph.nodes){const reference=all.nodes.find((r:any)=>r.id===n.id);assert.equal(n.x,reference.x);assert.equal(n.y,reference.y);}
    for(const a of graph.nodes)for(const b of graph.nodes)if(a!==b)assert.ok(a.x+graph.cardWidth<=b.x||b.x+graph.cardWidth<=a.x||a.y+graph.cardHeight<=b.y||b.y+graph.cardHeight<=a.y);
    for(const size of [{width:600,height:400},{width:2100,height:1200}]){const cam=centreOperationGraph(graph,'a',size,false),a=graph.nodes.find((n:any)=>n.id==='a');assert.ok(cam.s>=.6&&cam.s<=1.2);assert.equal((a.x+graph.cardWidth/2)*cam.s+cam.x,size.width/2);assert.equal((a.y+graph.cardHeight/2)*cam.s+cam.y,size.height/2);}
  }
});
test('drag suppresses the following native click; Open bypasses body selection', () => {
  let selected=0,prevented=0;const node={},target={closest:(s:string)=>s==='.op-node'?node:null};
  const gesture=operationGraphPointerHandlers({select:()=>selected++,pan:()=>{}});
  gesture.down({clientX:0,clientY:0,target});gesture.move({clientX:5,clientY:0});gesture.up();gesture.click({preventDefault:()=>prevented++,stopPropagation:()=>{}});assert.equal(selected,0);assert.equal(prevented,1);
  gesture.down({clientX:0,clientY:0,target:{closest:()=>node}});gesture.up();assert.equal(selected,0);
});

test('redaction memoization separates prose from path fields and preserves nested array rules', () => {
  const text='PASSWORD=secret-value', input={label:text,path:text,reads:[text,text],nested:{label:text,path:text},other:[text,text]};
  assert.deepEqual(redactDeep(input),{label:redact(text),path:redactPath(text),reads:[redactPath(text),redactPath(text)],nested:{label:redact(text),path:redactPath(text)},other:[redact(text),redact(text)]});
  assert.equal(redactDeep(text,'path'),redactPath(text));assert.equal(redactDeep(text),redact(text));
});
