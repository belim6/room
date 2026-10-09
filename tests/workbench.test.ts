import { Comparisons } from '../src/workbench/comparisons';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, clone } from '../src/workbench/store';
import { Engine as ProductionEngine } from '../src/workbench/engine';
// Existing fixtures exercise legacy rooms, including generation before anyone speaks.
// New-room framing is covered separately with ProductionEngine below.
class Engine extends ProductionEngine {
  override create(...args: Parameters<ProductionEngine['create']>) {
    if (!args[1]) { args[1]=initialState(); delete args[1].frame; }
    return super.create(...args);
  }
}
import { generate } from '../src/workbench/generation';
import { createApp } from '../src/workbench/server';
// New rooms default to a paid provider: any non-loopback request in tests is a bug.
// Engines built without a transport get this mock in place of the removed local demo.
const loopback=globalThis.fetch;process.env.OPENGATEWAY_API_KEY='test-key';
globalThis.fetch=((url:any,opts?:any)=>/^http:\/\/127\.0\.0\.1[:/]/.test(String(url))?loopback(url,opts):String(url).startsWith('https://apis.opengateway.ai/')?Promise.resolve(new Response(JSON.stringify({choices:[{message:{content:'Mock reply.'},finish_reason:'stop'}]}))):Promise.reject(Error('Live network call in tests: '+url))) as typeof fetch;
const roots: string[] = [];
function store() { const dir = fs.mkdtempSync(path.join(os.tmpdir(),'room-tests-')); roots.push(dir); return new Store(dir); }
const response = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { total_tokens: 42 } }));
test.after(()=>roots.forEach(p=>fs.rmSync(p,{recursive:true,force:true})));
const input = { provider: 'together' as const, model: 'test-model', persona: 'Boris' as const, temperature: .7,
  messages: [{ role: 'system', content: 'You are Boris' },{ role:'user',content:'Hello' }] };

test('attempt exists before dispatch; rejected raw output survives and retry is separate', async()=>{
  const s=store(); process.env.TOGETHER_API_KEY='test-secret'; let n=0;
  const result=await generate(input,s,async(_url,opts)=>{
    const requests=s.list('attempts'); assert.equal(requests.length,++n);
    assert.deepEqual(requests.find(r=>JSON.stringify(r.body)===opts?.body)?.body,JSON.parse(String(opts?.body)));
    assert(!JSON.stringify(requests).includes('test-secret'));
    return response(n===1?'Elorin: I said that.':'Boris: That is her claim, not mine.');
  });
  assert.equal(result.text,'That is her claim, not mine.');
  const attempts=s.attempts(); assert.equal(attempts.length,2);
  const rejected=attempts.find(a=>a.outcome.status==='rejected'); assert(rejected.outcome.raw.includes('Elorin'));
  const accepted=attempts.find(a=>a.outcome.status==='completed'); assert.equal(accepted.retryOf,rejected.id);
  assert.equal(accepted.outcome.usage.total_tokens,42); assert.equal(accepted.outcome.finishReason,'stop');
});
test('observe policy flags wrong identity without a retry; raw text and truncation remain inspectable', async()=>{
  const s=store(); const raw='Elorin: '+ 'x'.repeat(2100);
  const result=await generate({...input,policy:'observe'},s,async()=>response(raw));
  assert.equal(result.text.length,2000); assert(result.validation); assert.equal(s.attempts().length,1);
  assert(s.attempts()[0].outcome.raw.includes(raw)); assert(s.attempts()[0].outcome.transformations.includes('Truncated to 2000 characters'));
});
test('HTTP, transport, and missing-key failures are durable', async()=>{
  for(const transport of [async()=>new Response('provider failure',{status:400}),async()=>{throw Error('offline');}]) {
    const s=store(); await assert.rejects(generate(input,s,transport));assert.equal(s.attempts()[0].outcome.status,'failed');
  }
  delete process.env.TOGETHER_API_KEY;
  const s=store();await assert.rejects(generate(input,s,async()=>{throw Error('must not dispatch')}),/missing/);
  assert.equal(s.attempts().length,1);process.env.TOGETHER_API_KEY='test-secret';
});
test('historical forks restore prompt and memory; sibling edits and retcons stay isolated',()=>{
  const s=store(), e=new Engine(s);let b=e.create('Origin');
  let state=b.revision.state;state.characters.Boris.memory='Early memory';state.characters.Boris.prompt='Early prompt';
  b=e.commit(b.id,b.head,state,'Early settings');b=e.message(b.id,b.head,'A first event');const early=b.head;const message=b.revision.state.messages[0].id;
  state=b.revision.state;state.characters.Boris.memory='Future memory';state.characters.Boris.prompt='Future prompt';
  b=e.commit(b.id,b.head,state,'Later settings');b=e.message(b.id,b.head,'Later reply');
  const fork=e.fork(b.id,early,'Past');assert.equal(fork.revision.state.characters.Boris.memory,'Early memory');assert.equal(fork.revision.state.characters.Boris.prompt,'Early prompt');
  const preserved=e.fork(b.id,b.head,'Keep version');
  const retcon=e.retcon(b.id,b.head,message,'Changed event','regenerate','restore');
  assert.equal(retcon.revision.state.characters.Boris.prompt,'Early prompt');assert.equal(retcon.revision.state.messages.length,1);assert.equal(retcon.revision.state.characters.Boris.memory,'Early memory');
  assert.equal(retcon.id,b.id);assert.equal(e.read(b.id).revision.state.messages[0].text,'Changed event');assert.equal(s.get('revisions',b.head).state.messages[0].text,'A first event');
  const kept=e.retcon(preserved.id,preserved.head,message,'Changed event','keep','keep');const afterRetcon=e.fork(kept.id,kept.head,'Branch edited history',kept.revision.state.messages[0].id);assert.equal(afterRetcon.revision.state.messages.length,1);assert.equal(afterRetcon.revision.state.messages[0].text,'Changed event');assert.equal(kept.revision.state.messages.length,2);assert.equal(kept.revision.state.characters.Boris.memory,'Future memory');
  assert.equal(new Engine(new Store(s.root)).read(retcon.id).head,retcon.head);
});
test('forced and singleton random choices are recorded without Jev; stale edits are rejected',async()=>{
  const s=store(),e=new Engine(s);let b=e.create();let state=b.revision.state;state.participants=['Boris'];b=e.commit(b.id,b.head,state,'Roster');
  const old=b.head;b=await e.turn(b.id,b.head);assert.equal(b.revision.state.messages[0].speaker,'Boris');
  assert.equal(s.list('selections')[0].method,'random');assert.equal(s.list('jev-requests').length,0);
  await e.turn(b.id,b.head,'Boris');assert(s.list('selections').some(r=>r.method==='forced'));
  assert.throws(()=>e.commit(b.id,old,state,'stale'),/changed/);
  await assert.rejects(e.turn(b.id,e.read(b.id).head,'Rook'),/not participating/);
});
test('a forced pick repeated across a run is recorded once as forced, then locked',async()=>{
  const s=store(),e=new Engine(s);let b=e.create();
  for(let index=1;index<=3;index++)b=await e.turn(b.id,b.head,'Boris',{id:'run-1',index,count:3});
  b=await e.turn(b.id,b.head,undefined,{id:'run-2',index:2,count:2});
  const byRun=(runId:string)=>s.list('selections').filter(r=>r.run?.id===runId).sort((x,y)=>x.run.index-y.run.index).map(r=>r.method);
  assert.deepEqual(byRun('run-1'),['forced','locked','locked']);assert.deepEqual(byRun('run-2'),['random']);
});
test('late result after editing is detached; canceled result never enters history',async()=>{
  for(const cancel of [false,true]) {
    const s=store();let resolve: (r:Response)=>void=()=>{};const e=new Engine(s,()=>new Promise(r=>{resolve=r}));let b=e.create();
    let state=b.revision.state;state.characters.Boris.provider='together';state.characters.Boris.model='test';b=e.commit(b.id,b.head,state,'Live mock');
    const pending=e.turn(b.id,b.head,'Boris');
    if(cancel)e.cancel(b.id);else e.message(b.id,b.head,'An intervening edit');
    resolve(response('Boris: Late reply'));await pending;
    assert.equal(e.read(b.id).revision.state.messages.filter(m=>m.source==='generated').length,0);
    assert.equal(s.list('turns')[0].status,cancel?'canceled':'detached');
    assert.equal(s.attempts()[0].outcome.raw.includes('Late reply'),true);
  }
});
test('shadow call does not block generation or contaminate model context',async()=>{
  const s=store();let resolveJev:(r:Response)=>void=()=>{};
  process.env.TYPESAFE_API_KEY='test-jev';
  const e=new Engine(s,(url)=>String(url).includes('typesafe')?new Promise(r=>{resolveJev=r}):Promise.resolve(response('Hello.')));
  let b=e.create();const state=b.revision.state;state.shadow=true;b=e.commit(b.id,b.head,state,'Shadow on');
  const done=await e.turn(b.id,b.head,'Boris');assert.equal(done.revision.state.messages.length,1);
  assert.equal(s.list('jev-results').length,0);assert.equal(s.list('jev-requests').length,1);
  assert(!JSON.stringify(s.attempts()[0].body).includes('next_speaker'));
  resolveJev(new Response('unavailable',{status:503}));await new Promise(r=>setImmediate(r));
  assert.equal(s.list('jev-results')[0].status,'failed');
});
test('local HTTP API serves UI, rejects foreign origins, imports and exports evidence',async()=>{
  const s=store(),e=new Engine(s);const server=createApp(e).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${(server.address() as any).port}`;
  try {
    assert.equal((await fetch(base)).status,200);
    assert.equal((await fetch(base+'/api/bootstrap',{headers:{Origin:'https://evil.example'}})).status,403);
    const post=async(url:string,body:any)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json()};
    let b=await post('/api/import',{id:'old-save',history:['Dennis: hello','Boris: hi'],participants:['Boris'],assignments:{}});
    assert.equal(b.revision.state.messages[0].source,'imported');
    b=await post(`/api/branches/${b.id}/turn`,{expected:b.head,speaker:'Boris'});
    const history=await post(`/api/branches/${b.id}/history`,{expected:b.head,messages:[{speaker:'Rook',text:'Inserted account'}],memory:'clear'}); assert.equal(history.revision.state.messages.length,1);assert.equal(history.revision.state.messages[0].source,'edited');assert.equal(history.id,b.id);assert.equal(e.read(b.id).revision.state.messages.length,1);assert.equal(s.get('revisions',b.head).state.messages.length,3);
    const exported=await (await fetch(base+`/api/branches/${b.id}/export`)).json();assert.equal(exported.attempts.length,1);
    assert.equal(exported.selections[0].method,'forced');assert(!JSON.stringify(exported).includes('test-secret'));
  } finally {await new Promise<void>(r=>server.close(()=>r()));}
});


test('comparison snapshots isolate both directions, settings, copies and comparison forks',async()=>{
  const s=store(),e=new Engine(s),comparisons=new Comparisons(e);
  let left=e.create('Left'),right=e.create('Right');
  left=e.message(left.id,left.head,'Left initial');right=e.message(right.id,right.head,'Right initial');
  const saved=comparisons.save({name:'Two viewpoints',left:left.id,right:right.id});
  assert.notEqual(saved.left,left.id);assert.notEqual(saved.right,right.id);
  assert.equal(e.read(saved.left).comparison,saved.id);assert.equal(e.read(saved.left).parent,null);
  left=await e.turn(left.id,left.head,'Boris');right=await e.turn(right.id,right.head,'Elorin');
  assert.equal(e.read(saved.left).revision.state.messages.length,1);
  assert.equal(e.read(saved.right).revision.state.messages.length,1);
  let pane=e.read(saved.left);pane.revision.state.characters.Boris.memory='Inside comparison';
  pane=e.commit(pane.id,pane.head,pane.revision.state,'Memory edit');pane=await e.turn(pane.id,pane.head,'Rook');
  assert.equal(e.read(left.id).revision.state.characters.Boris.memory,'');
  assert.equal(e.read(left.id).revision.state.messages.at(-1)?.speaker,'Boris');
  assert.equal(new Comparisons(new Engine(new Store(s.root))).get(saved.id).left,pane.id);
  const fork=comparisons.fork(saved.id,'Alternative pair',saved.version);
  assert.equal(fork.parent,saved.id);assert.notEqual(fork.left,saved.left);assert.notEqual(fork.right,saved.right);
  assert.deepEqual(e.read(fork.left).revision.state,pane.revision.state);
  const changed=await e.turn(fork.left,e.read(fork.left).head,'Ilya');
  assert.equal(e.read(saved.left).revision.state.messages.length,2);
  assert.equal(changed.revision.state.messages.length,3);
  // Importing another comparison's pane must copy it, never share ownership.
  const updated=comparisons.save({id:saved.id,expected:saved.version,name:'Updated pair',left:fork.left,right:saved.right});
  assert.notEqual(updated.left,fork.left);assert.equal(updated.right,saved.right);
  assert.throws(()=>comparisons.save({id:saved.id,expected:saved.version,name:'Stale',left:saved.left,right:saved.right}),/changed/);
  const localFork=e.fork(updated.left,e.read(updated.left).head,'Pane branch');
  assert.equal(localFork.comparison,saved.id);
  const resaved=comparisons.save({id:saved.id,expected:updated.version,name:updated.name,left:localFork.id,right:updated.right});
  assert.equal(resaved.left,localFork.id);
  const independent=comparisons.save({name:'Same inputs, new experiment',left:left.id,right:right.id});
  assert.notEqual(independent.left,saved.left);
  assert.throws(()=>comparisons.save({name:'Invalid',left:saved.left,right:saved.left}),/different/);
});

test('legacy comparisons convert once, keep current content, and preserve original pairing records',()=>{
  const s=store(),e=new Engine(s),c=new Comparisons(e);let left=e.create('Legacy left');const right=e.create('Legacy right');
  const old={id:'legacy',version:'old-version',name:'Legacy comparison',left:left.id,right:right.id,parent:null,createdAt:'2026-09-22',updatedAt:'2026-09-22'};
  s.put('comparisons',old.id,old);s.put('comparison-revisions',old.version,{...old,leftRevision:left.head,rightRevision:right.head});
  left=e.message(left.id,left.head,'Keep existing content regardless of where it was added');
  const converted=c.list()[0];assert.equal(converted.isolation,'owned-v1');
  assert.deepEqual(e.read(converted.left).revision.state,left.revision.state);
  assert.equal(s.get('comparison-revisions',old.version).left,left.id);
  assert.equal(c.get(old.id).version,converted.version);assert.equal(s.list('branches').length,4);
  e.message(left.id,left.head,'After conversion');assert.equal(e.read(converted.left).revision.state.messages.length,1);
});

test('comparison routes create isolated drafts, persist pane edits and survive source deletion',async()=>{
  const e=new Engine(store()),left=e.create('A'),right=e.create('B');
  const server=createApp(e).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${(server.address() as any).port}/api`;
  const post=async(url:string,body:any)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json()};
  try{
    const draft=await post('/comparisons/draft',{left:left.id,right:right.id});
    assert.equal((await (await fetch(base+'/bootstrap')).json()).comparisons.length,0);
    const added=await post('/branches/'+draft.left+'/messages',{expected:e.read(draft.left).head,text:'Only inside draft'});
    assert.equal(e.read(left.id).revision.state.messages.length,0);
    const saved=await post('/comparisons',{id:draft.id,expected:draft.version,name:'API pair',left:draft.left,right:draft.right});
    assert.equal(saved.left,draft.left);assert.equal(saved.draft,false);
    const bootstrap=await (await fetch(base+'/bootstrap')).json();assert.equal(bootstrap.comparisons[0].id,saved.id);
    const opened=await (await fetch(base+'/comparisons/'+saved.id)).json();assert.equal(opened.left,saved.left);
    const fork=await post('/comparisons/'+saved.id+'/fork',{name:'Branch pair',expected:saved.version});
    assert.equal(fork.parent,saved.id);assert.equal(e.read(fork.left).comparison,fork.id);
    assert.equal(e.store.list('attempts').length,0);
    const removed=await post('/branches/'+saved.left+'/messages/'+added.revision.state.messages[0].id+'/delete',{expected:added.head});
    assert.equal(removed.revision.state.messages.length,0);assert.equal(e.read(fork.left).revision.state.messages.length,1);
    await post('/branches/'+saved.left+'/messages/restore',{expected:removed.head,deletion:removed.head});
    assert.equal(e.read(saved.left).revision.state.messages.length,1);
    await post('/branches/'+left.id+'/trash',{expected:left.head});
    const hidden=await (await fetch(base+'/bootstrap')).json();
    assert.equal(hidden.comparisons.length,2);assert(!hidden.branches.some((b:any)=>b.id===left.id));
    assert.equal((await fetch(base+'/comparisons/'+saved.id)).status,200);
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
});

test('trash preserves evidence, restores subtrees, and leaves separately deleted branches in Trash',async()=>{
  const s=store(),e=new Engine(s);let original=e.create('Original');
  original=await e.turn(original.id,original.head,'Boris');
  const child=e.fork(original.id,original.head,'Child'),grandchild=e.fork(child.id,child.head,'Grandchild');
  const sibling=e.fork(original.id,original.head,'Sibling');
  const observations={id:'note',branch:child.id,text:'Keep this observation'};s.put('observations','note',observations);
  const before={branches:s.list('branches'),revisions:s.list('revisions'),attempts:s.attempts(),turns:s.list('turns')};
  const deletedChild=e.trash(child.id,child.head);
  assert.deepEqual(new Set(deletedChild.branches),new Set([child.id,grandchild.id]));
  assert.equal(e.read(sibling.id).head,sibling.head);
  assert.throws(()=>e.commit(child.id,child.head,child.revision.state,'stale editor'),/Trash/);
  await assert.rejects(e.turn(child.id,child.head,'Boris'),/Trash/);
  assert.throws(()=>e.fork(child.id,child.head,'Hidden copy'),/Trash/);
  const deletedParent=e.trash(original.id,original.head);
  assert.deepEqual(new Set(deletedParent.branches),new Set([original.id,sibling.id]));
  assert.equal(e.library().branches.length,0);
  assert.equal(e.library().trash.find(t=>t.id===deletedChild.id)?.canRestore,false);
  assert.throws(()=>e.restore(deletedChild.id),/parent/);
  const restarted=new Engine(new Store(s.root));
  restarted.restore(deletedParent.id);
  assert.equal(restarted.read(original.id).head,original.head);
  assert.equal(restarted.read(sibling.id).head,sibling.head);
  assert.throws(()=>restarted.read(child.id),/Trash/);
  restarted.restore(deletedChild.id);
  assert.equal(restarted.read(grandchild.id).head,grandchild.head);
  assert.equal(restarted.library().trash.length,0);
  assert.deepEqual({branches:s.list('branches'),revisions:s.list('revisions'),attempts:s.attempts(),turns:s.list('turns')},before);
  assert.deepEqual(s.get('observations','note'),observations);
});

test('deleting refuses stale edits and running descendants without changing the library',async()=>{
  let resolve:(r:Response)=>void=()=>{};
  const s=store(),e=new Engine(s,()=>new Promise(r=>{resolve=r}));
  let root=e.create('Running family');const old=root.head;
  root=e.message(root.id,root.head,'New message');
  assert.throws(()=>e.trash(root.id,old),/changed/);
  let child=e.fork(root.id,root.head,'Active child');
  child.revision.state.characters.Boris.provider='together';
  child=e.commit(child.id,child.head,child.revision.state,'Mock model');
  const pending=e.turn(child.id,child.head,'Boris');
  assert.throws(()=>e.trash(root.id,root.head),/Stop generation/);
  assert.equal(e.library().trash.length,0);
  resolve(response('Boris: Finished'));await pending;
  e.trash(root.id,root.head);assert.equal(e.library().branches.length,0);
});


test('message deletion changes only effective history and restoration preserves IDs and later messages',async()=>{
  const s=store(),e=new Engine(s);let b=e.create('Delete messages');
  b=e.message(b.id,b.head,'First');b=await e.turn(b.id,b.head,'Boris');b=e.message(b.id,b.head,'Later');
  const before=structuredClone(b),message=b.revision.state.messages[1],attempts=s.attempts();
  const sibling=e.fork(b.id,b.head,'Sibling');
  b=e.deleteMessage(b.id,b.head,message.id);
  assert.equal(b.id,before.id);assert.deepEqual(b.revision.state.messages.map(m=>m.text),['First','Later']);
  assert.deepEqual(s.get('revisions',before.head).state,before.revision.state);
  assert.deepEqual(s.attempts(),attempts);assert.equal(e.read(sibling.id).revision.state.messages.length,3);
  const deletion=b.head;b=await e.turn(b.id,b.head,'Ilya');
  const latest=s.attempts().find(a=>a.persona==='Ilya');assert(!JSON.stringify(latest.body).includes(message.text));
  assert.throws(()=>e.restoreMessage(sibling.id,sibling.head,deletion),/does not belong/);
  assert.throws(()=>e.restoreMessage(b.id,before.head,deletion),/changed/);
  b=e.restoreMessage(b.id,b.head,deletion);
  assert.deepEqual(b.revision.state.messages[1],message);assert.equal(b.revision.state.messages.length,4);
  assert.throws(()=>e.restoreMessage(b.id,b.head,deletion),/already present/);
  assert.throws(()=>e.deleteMessage(b.id,b.head,'missing'),/no longer exists/);
  e.active.set(b.id,{controller:new AbortController(),turnId:'active'});
  assert.throws(()=>e.deleteMessage(b.id,b.head,message.id),/Stop generation/);e.active.delete(b.id);
});

test('Jev readout keeps confidence distinct from choice probabilities and uses recorded turn selection',()=>{
  const {render}=require('../web/jev-view.js');
  const observation={turnId:'turn',outcome:{status:'completed',answers:{next_speaker:{choice:'Alexandra',confidence:.43,probabilities:{Boris:0,Alexandra:.51,Ilya:.49}},needs_research:{noul:0}}}};
  const html=render({turnId:'turn',speaker:'Ilya',source:'generated'},[observation],[{id:'turn',chosen:'Ilya',method:'forced'}]);
  assert.match(html,/Jev confidence <strong>43%/);assert.match(html,/>51%<\/strong>/);
  assert.match(html,/Actually selected: <strong>Ilya<\/strong> · your pick/);
  assert.match(html,/Before this reply/);assert.match(html,/External research needed<\/span><strong>0%/);
  assert(html.indexOf('Alexandra speaker probability')<html.indexOf('Ilya speaker probability'));
  assert.match(render({turnId:'turn',source:'edited'},[observation]),/observation belongs to the original turn/);
  assert.match(render({turnId:'another'},[observation]),/No Jev observation recorded/);
});

test('Jev readout distinguishes missing scores, pending and failed observations and escapes provider strings',()=>{
  const {render}=require('../web/jev-view.js'),message={turnId:'turn',speaker:'Boris'};
  assert.match(render(message,[{turnId:'turn'}]),/Observation pending/);
  assert.match(render(message,[{turnId:'turn',outcome:{status:'interrupted'}}]),/Observation interrupted/);
  const failed=render(message,[{turnId:'turn',outcome:{status:'failed',error:'<script>bad</script>'}}]);
  assert.match(failed,/Observation failed/);assert(!failed.includes('<script>'));
  const missing=render(message,[{turnId:'turn',outcome:{status:'completed',answers:{next_speaker:{choice:'<b>x</b>',confidence:null,probabilities:{Boris:2}}}}}]);
  assert.match(missing,/Jev confidence <strong>Unavailable/);assert.match(missing,/Speaker probabilities unavailable/);assert(!missing.includes('<b>x</b>'));
});

import { lineDiff, stateChanges } from '../src/workbench/changes';
import { initialState } from '../src/workbench/engine';
import { Experiments, applyPatch, extractOutcome } from '../src/workbench/experiments';
import { reasoningOf } from '../src/workbench/generation';
test('line diff reconstructs both inputs for insert, delete, replace and large fallback',()=>{
  for(const [a,b] of [['a\nc','a\nb\nc'],['a\nb\nc','a\nc'],['a\nb','a\nc'],['','new'],['old',''],['x\n'.repeat(2001),'replacement']]){
    const d=lineDiff(a,b);assert.equal(d.filter(l=>l.op!=='add').map(l=>l.text).join('\n'),a);assert.equal(d.filter(l=>l.op!=='del').map(l=>l.text).join('\n'),b);
  }
  assert.deepEqual(lineDiff('a\nb','a\nc').map(l=>l.op),['same','del','add']);
});
test('state changes cover all fields, provenance, additions, removals and order',()=>{
  const from=initialState();from.messages=[{id:'one',speaker:'Boris',text:'Old',source:'human'},{id:'two',speaker:'Ilya',text:'Keep',source:'generated'},{id:'three',speaker:'Ilya',text:'Remove',source:'generated'}];
  const to=applyPatch(from,{system:'New\nrules',human:'Deniz',participants:['Boris'],shadow:true,policy:'observe',characters:{Boris:{prompt:'New\npersona',memory:'M',provider:'together',model:'other',temperature:1}}});
  to.messages=[{...from.messages[1]},{id:'insert',speaker:'Boris',text:'Inserted',source:'edited'},{...from.messages[0],id:'edited',source:'edited',editedFrom:['one'],text:'New'},{id:'append',speaker:'Boris',text:'Reply',source:'generated'}];
  const diff=stateChanges(from,to);assert.equal(diff.settings.length,10);assert(diff.settings.find(s=>s.field==='system')?.diff);
  assert.deepEqual(diff.conversation,{appended:{generated:1},edited:['edited'],removed:['three'],inserted:['insert'],reordered:true});
  const legacy=structuredClone(from);legacy.messages[0]={...legacy.messages[0],id:'unknown',source:'edited'};
  assert.deepEqual(stateChanges(from,legacy).conversation.edited,[],'Do not invent legacy edit provenance');
});
test('retcons retain edit ancestry across repeated changes',()=>{
  const e=new Engine(store());let b=e.create();b=e.message(b.id,b.head,'Original');
  const original=b.revision.state.messages[0].id,one=e.retcon(b.id,b.head,original,'Edit one','keep','keep');
  const two=e.retcon(one.id,one.head,one.revision.state.messages[0].id,'Edit two','keep','keep');
  assert.deepEqual(stateChanges(b.revision.state,two.revision.state).conversation.edited,[two.revision.state.messages[0].id]);
  assert.deepEqual(stateChanges(b.revision.state,two.revision.state).conversation.removed,[]);
});
function design(e:Engine){const b=e.create('Experiment base');return {name:'Test',question:'Does the instruction change the reply?',prediction:'The variant names a different person.',base:{branch:b.id,revision:b.head},speaker:'Boris',conditions:[{key:'A',label:'Control',control:true,patch:{}},{key:'B',label:'Variant',patch:{system:'Different rules'}}],outcome:{pattern:'I vote\\s+\\**([A-Za-z]+)',flags:'gi',highlight:{Elorin:'wolf'}}};}
test('patches are isolated and validate fields; extraction is bounded and last match wins',()=>{
  const base=initialState(),next=applyPatch(base,{characters:{Boris:{memory:'New memory',temperature:1}},system:'Variant'});
  assert.equal(base.characters.Boris.memory,'');assert.equal(next.characters.Boris.prompt,base.characters.Boris.prompt);
  assert.throws(()=>applyPatch(base,{messages:[]} as any),/Only settings/);assert.throws(()=>applyPatch(base,{characters:{Wrong:{model:'bad'}}} as any),/Invalid character/);
  assert.equal(extractOutcome('I vote Jonas. Actually, I vote **Elorin**.',{pattern:'I vote\\s+\\**([A-Za-z]+)',flags:'gi'}).value,'Elorin');
  assert.equal(extractOutcome('No vote',{pattern:'I vote (\\w+)'}).value,null);
  assert(extractOutcome('a'.repeat(10000)+'!',{pattern:'(a+)+$'}).error);
});
test('provider reasoning extraction ignores absent, malformed and non-string content',()=>{
  assert.equal(reasoningOf({raw:JSON.stringify({choices:[{message:{reasoning_content:'Recorded rationale'}}]})}),'Recorded rationale');
  for(const raw of ['{}','broken',JSON.stringify({choices:[{message:{reasoning_content:{private:'no'}}}]})])assert.equal(reasoningOf({raw}),null);
  assert.equal(reasoningOf(null),null);
});
test('experiments freeze design, persist intent before dispatch, force independent turns and resume numbering',async()=>{
  const s=store();let planned=0;
  const e=new Engine(s,async()=>{planned=s.list('experiment-trials').length;assert(planned>=4);return response('I vote Elorin.');});
  const input=design(e);input.conditions.forEach(c=>(c.patch as any).characters={Boris:{provider:'together',model:'mock'}});
  const x=new Experiments(e),draft=x.create(input),edited=x.edit(draft.id,{...input,prediction:'Revised before running',expected:draft.version});
  assert.throws(()=>x.edit(draft.id,{...input,expected:draft.version}),/changed/);
  assert.equal(s.get('experiments',draft.id).prediction,input.prediction,'initial design is immutable');
  x.run(draft.id,2,edited.version);assert(x.get(draft.id).lockedAt);await x.active.get(draft.id)?.done;
  assert.throws(()=>x.edit(draft.id,{...input,expected:edited.version}),/locked/);
  let rows=x.detail(draft.id).trials;assert.equal(rows.length,4);assert(rows.every(t=>t.status==='completed'&&t.effectiveOutcome==='Elorin'));
  assert(s.list('selections').every(r=>r.method==='forced'&&r.run.id===draft.id));
  x.run(draft.id,1,edited.version);await x.active.get(draft.id)?.done;rows=x.detail(draft.id).trials;
  assert.deepEqual(rows.filter(t=>t.condition==='A').map(t=>t.index),[1,2,3]);assert.equal(planned,6);
  const first=rows[0];x.label(draft.id,first.id,{outcome:'Jonas',tag:'villager',note:'Manual interpretation'});
  const labeled=x.detail(draft.id).trials.find(t=>t.id===first.id)!;assert.equal(labeled.extracted,'Elorin');assert.equal(labeled.effectiveOutcome,'Jonas');
  const b=e.read(first.branch);e.message(b.id,b.head,'Later conversation');assert.equal(x.detail(draft.id).trials.find(t=>t.id===first.id)!.reply,'I vote Elorin.');
});
test('attaching validates measured input, is retrospective, makes no calls, and preserves original trial evidence',async()=>{
  const e=new Engine(store()),input=design(e),x=new Experiments(e),exp=x.create(input);
  let b=e.fork(input.base.branch,input.base.revision,'Existing trial');b=await e.turn(b.id,b.head,'Boris');const attempts=e.store.attempts().length;
  const t=x.attach(exp.id,{condition:'A',branch:b.id});assert(x.get(exp.id).retrospective);assert.equal(e.store.attempts().length,attempts);
  assert.throws(()=>x.attach(exp.id,{condition:'A',branch:b.id}),/already attached/);
  assert.throws(()=>x.attach(exp.id,{condition:'B',branch:b.id}),/does not match/);
  assert.equal(x.detail(exp.id).trials[0].turnId,t.turnId);e.deleteMessage(b.id,b.head,b.revision.state.messages[0].id);
  assert(x.detail(exp.id).trials[0].reply.includes('Mock reply'));
});
test('experiment timeouts retry twice with durable attempts; non-timeout failures do not retry',async()=>{
  for(const timeout of [true,false]){
    let calls=0;const e=new Engine(store(),async()=>{calls++;throw timeout?new DOMException('Timed out','TimeoutError'):Error('Offline');});
    const input=design(e);input.conditions=input.conditions.slice(0,1);input.conditions[0].patch={characters:{Boris:{provider:'together',model:'mock'}}} as any;
    const x=new Experiments(e),exp=x.create(input);x.run(exp.id,1,exp.version);await x.active.get(exp.id)?.done;
    assert.equal(calls,timeout?3:1);assert.equal(e.store.attempts().length,calls);assert.equal(x.trials(exp.id)[0].status,'failed');
    assert.equal(x.detail(exp.id).trials[0].attempts.length,calls);
  }
});
test('Stop preserves completed trials and cancels in-flight and queued trials; recovery never dispatches',async()=>{
  let calls=0,started!:()=>void;const waiting=new Promise<void>(resolve=>started=resolve);
  const e=new Engine(store(),async(_url,options)=>{if(++calls===1)return response('I vote Jonas.');started();return new Promise((_resolve,reject)=>{options?.signal?.addEventListener('abort',()=>reject(new DOMException('Canceled','AbortError')),{once:true});});});
  const input=design(e);input.conditions=input.conditions.slice(0,1);input.conditions[0].patch={characters:{Boris:{provider:'together',model:'mock'}}} as any;
  const x=new Experiments(e),exp=x.create(input);x.run(exp.id,3,exp.version);const done=x.active.get(exp.id)!.done;await waiting;x.stop(exp.id);await done;
  assert.deepEqual(x.trials(exp.id).map(t=>t.status),['completed','canceled','canceled']);assert.equal(calls,2);
  const old=x.trials(exp.id)[0];e.store.put('experiment-trials','interrupted',{...old,id:'interrupted',turnId:'never-dispatched',status:'queued',index:4});
  new Experiments(e).recover();assert.equal(calls,2);assert.equal(x.trials(exp.id).find(t=>t.id==='interrupted')?.status,'canceled');
});
test('changes and experiment HTTP workflow exposes original null, diffs, lock and labels',async()=>{
  const e=new Engine(store()),app=createApp(e),server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as any).port}`;
  async function api(url:string,body?:any){const r=await fetch(base+'/api'+url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});return {status:r.status,value:await r.json() as any};}
  try {
    const input=design(e);assert.equal((await api('/branches/'+input.base.branch+'/changes')).value.fork,null);
    const exp=(await api('/experiments',input)).value;await api('/experiments/'+exp.id+'/run',{perCondition:2,expected:exp.version});await app.locals.experiments.active.get(exp.id)?.done;
    const detail=(await api('/experiments/'+exp.id)).value;assert.equal(detail.trials.length,4);assert(detail.trials.every((t:any)=>t.status==='completed'));
    assert.equal((await api('/experiments/'+exp.id+'/edit',{...input,expected:exp.version})).status,400);
    const trial=detail.trials.find((t:any)=>t.condition==='B'),diff=(await api('/branches/'+trial.branch+'/changes')).value;
    assert.equal(diff.fork.revision,app.locals.experiments.workspaceOf(exp.id).revision);assert(diff.changes.settings.some((s:any)=>s.field==='system'));
    await api('/experiments/'+exp.id+'/labels',{trial:trial.id,outcome:'Test',tag:'manual'});
    assert.equal((await api('/experiments/'+exp.id)).value.trials.find((t:any)=>t.id===trial.id).effectiveOutcome,'Test');
  } finally{await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
});
test('change renderer escapes text, collapses unchanged lines, groups models and limits summaries in UI',()=>{
  const view=require('../web/changes-view.js');const a=initialState(),b=structuredClone(a);
  for(const c of Object.values(b.characters))c.model='new-model';b.system='unsafe <script>\nnew line';
  const changes=stateChanges(a,b),html=view.render(changes);assert(html.includes('(8 characters)'));assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));
  assert(view.diff(lineDiff('a\nb\nc\nd\ne','a\nb\nc\nd\nf')).includes('4 unchanged lines'));
  assert(view.badges(changes).includes('model changed ×8'));
});
test('branching copies the design into a blank-intent draft; links reject cycles; lineage aligns designs without pooling',async()=>{
  const s=store();let n=0;
  const e=new Engine(s,async()=>new Response(JSON.stringify({choices:[{message:{content:'I vote Elorin.'},finish_reason:'stop'}],usage:{completion_tokens:100*++n,total_tokens:1000}})));
  const input=design(e);input.conditions.forEach(c=>(c.patch as any).characters={Boris:{provider:'together',model:'mock'}});
  const x=new Experiments(e),parent=x.create(input);x.run(parent.id,2,parent.version);await x.active.get(parent.id)?.done;
  const before=JSON.stringify(x.get(parent.id)),child=x.branch(parent.id,{name:'Child'});
  assert.equal(child.parent,parent.id);assert.equal(child.question,'');assert.equal(child.prediction,'');assert(!x.get(child.id).lockedAt);
  assert.deepEqual(child.conditions,parent.conditions);assert.deepEqual(child.outcome,parent.outcome);assert.equal(JSON.stringify(x.get(parent.id)),before);
  assert.throws(()=>x.run(child.id,1,child.version),/question/);
  assert.deepEqual(x.detail(child.id).designDiff,{base:null,speaker:null,conditions:[],outcome:null});
  const conditions=clone(child.conditions);conditions[1].patch.characters!.Boris!.temperature=0;conditions.push({key:'C',label:'New',patch:{}});
  const edited=x.edit(child.id,{...child,question:'Fresh question',prediction:'Fresh prediction',conditions:conditions.filter(c=>c.key!=='A').map(c=>c.key==='C'?{...c,control:true}:c),expected:child.version});
  const diff=x.detail(child.id).designDiff!;
  assert.deepEqual(diff.conditions.map(c=>[c.key,c.change]),[['A','removed'],['C','added'],['B','changed']]);
  assert.deepEqual((diff.conditions[2] as any).changes.settings.map((c:any)=>[c.field,c.character,c.before,c.after]),[['temperature','Boris',.7,0]]);
  assert.equal(x.get(edited.id).parent,parent.id);
  const sibling=x.create({...input,name:'Independent'});
  assert.throws(()=>x.link(child.id,{parent:sibling.id}),/branched/);
  x.link(sibling.id,{parent:child.id});assert.throws(()=>x.link(parent.id,{parent:sibling.id}),/cycle/);assert.throws(()=>x.link(sibling.id,{parent:sibling.id}),/cycle/);
  assert.equal(x.detail(sibling.id).parent!.linked,true);
  x.run(sibling.id,1,sibling.version);await x.active.get(sibling.id)?.done;assert.equal(x.parentOf(sibling.id),child.id,'links survive locking');
  const lineage=x.detail(child.id).lineage;assert.deepEqual(lineage.map(l=>l.name),['Test','Child','Independent']);
  const aTest=lineage[0].conditions.find(c=>c.key==='A')!,aIndependent=lineage[2].conditions.find(c=>c.key==='A')!;
  assert.equal(aTest.design,aIndependent.design);assert.equal(aTest.n,2);assert.equal(aIndependent.n,1);
  assert.notEqual(lineage[1].conditions.find(c=>c.key==='B')!.design,lineage[0].conditions.find(c=>c.key==='B')!.design);
  assert(typeof aTest.medianTokens==='number'&&aTest.window);
});
import { validateState } from '../src/workbench/engine';
test('reasoning off maps to the verified provider switch, is rejected unverified before dispatch, and shows as a change',async()=>{
  const s=store();process.env.OPENGATEWAY_API_KEY='test-secret';let sent:any;
  await generate({...input,provider:'opengateway',reasoning:'off'},s,async(_u,opts)=>{sent=JSON.parse(String(opts?.body));return response('Fine.');});
  assert.deepEqual(sent.thinking,{type:'disabled'});assert.deepEqual(s.attempts()[0].body.thinking,{type:'disabled'},'switch is in the persisted request');
  await generate({...input,provider:'opengateway'},s,async(_u,opts)=>{sent=JSON.parse(String(opts?.body));return response('Fine.');});assert(!('thinking' in sent));
  const before=s.list('attempts').length;
  await assert.rejects(generate({...input,reasoning:'off'},s,async()=>{throw Error('must not dispatch');}),/not verified for together/);
  assert.equal(s.list('attempts').length,before);
  const state=initialState();state.characters.Boris.reasoning='off';validateState(state);
  state.characters.Boris.provider='together';assert.throws(()=>validateState(state),/not verified/);
  assert.throws(()=>validateState({...initialState(),characters:{...initialState().characters,Boris:{...initialState().characters.Boris,reasoning:'low' as any}}}),/Invalid character/);
  const from=initialState(),to=applyPatch(from,{characters:{Boris:{reasoning:'off'}}});
  assert.deepEqual(stateChanges(from,to).settings.map(c=>[c.field,c.character,c.before,c.after]),[['reasoning','Boris','default','off']]);
  const explicit=clone(from);explicit.characters.Boris.reasoning='default';assert.equal(stateChanges(from,explicit).settings.length,0);
});
test('trial results expose measured completion tokens, reasoning characters and provider reasoning tokens',async()=>{
  const s=store();const e=new Engine(s,async()=>new Response(JSON.stringify({choices:[{message:{content:'I vote Elorin.',reasoning_content:'Think.'},finish_reason:'stop'}],usage:{completion_tokens:321,total_tokens:999,completion_tokens_details:{reasoning_tokens:300}}})));
  const input=design(e);input.conditions.forEach(c=>(c.patch as any).characters={Boris:{provider:'together',model:'mock'}});
  const x=new Experiments(e),exp=x.create(input);x.run(exp.id,1,exp.version);await x.active.get(exp.id)?.done;
  const [t]=x.detail(exp.id).trials;assert.equal(t.completionTokens,321);assert.equal(t.reasoningChars,6);assert.equal(t.reasoningTokens,300);assert.equal(t.tokens,999);
});
test('reactions are append-only, latest per message wins, and never enter model context',async()=>{
  const s=store();let prompt='';const e=new Engine(s,async(_u,opts)=>{prompt=String(opts?.body);return response('Noted.');}),app=createApp(e),server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as any).port}`;
  async function api(url:string,body?:any){const r=await fetch(base+'/api'+url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});return {status:r.status,value:await r.json() as any};}
  try {
    let b=e.create('Reactions');b=e.message(b.id,b.head,'Hello');const m=b.revision.state.messages[0];
    assert.deepEqual((await api('/reactions',{branch:b.id,message:m.id,value:'favorite'})).value,{[m.id]:'favorite'});
    assert.deepEqual((await api('/reactions',{branch:b.id,message:m.id,value:'dislike'})).value,{[m.id]:'dislike'});
    assert.equal((await api('/reactions',{branch:b.id,message:'missing',value:'favorite'})).status,400);
    assert.equal((await api('/reactions',{branch:b.id,message:m.id,value:'love'})).status,400);
    assert.deepEqual((await api('/bootstrap')).value.reactions,{[m.id]:'dislike'});
    assert.deepEqual((await api('/reactions',{branch:b.id,message:m.id,value:null})).value,{});
    assert.deepEqual(s.list('reactions').sort((a,b)=>a.sequence-b.sequence).map(r=>r.value),['favorite','dislike',null]);
    await api('/reactions',{branch:b.id,message:m.id,value:'favorite'});
    const favorites=(await api('/reactions/favorite')).value;assert.equal(favorites.length,1);assert.equal(favorites[0].text,'Hello');assert.equal(favorites[0].branchName,'Reactions');assert.equal(favorites[0].history.length,4);
    assert.deepEqual((await api('/reactions/dislike')).value,[]);assert.equal((await api('/reactions/love')).status,400);
    const exported=await (await fetch(base+'/api/reactions/favorite/export')).json() as any;assert.equal(exported.format,'room-reactions-v1');assert.equal(exported.items[0].message,m.id);
    assert.equal((await api('/branches/'+b.id)).value.reactions.length,4,'branch export carries the full mark history');
    const c=e.read(b.id);c.revision.state.characters.Boris.provider='together';c.revision.state.characters.Boris.model='mock';
    const next=e.commit(b.id,c.head,c.revision.state,'Use mock');process.env.TOGETHER_API_KEY='k';await e.turn(next.id,next.head,'Boris');
    assert(!/favorite|dislike/i.test(prompt));
  } finally { server.close(); }
});
test('experiments run in their own workspace, created once; tagged and attached trials are flagged out of families',async()=>{
  const s=store();const e=new Engine(s,async()=>response('I vote Elorin.'));
  const input=design(e);input.conditions.forEach(c=>(c.patch as any).characters={Boris:{provider:'together',model:'mock'}});
  const x=new Experiments(e),exp=x.create(input);
  x.run(exp.id,2,exp.version);await x.active.get(exp.id)?.done;
  const ws=x.workspaceOf(exp.id)!,wb=e.read(ws.branch);
  assert.equal(wb.parent,null);assert.equal(wb.fork,input.base.revision);assert.equal(wb.workspace,true);assert.equal(wb.experiment,exp.id);
  const trials=x.trials(exp.id);assert.equal(trials.length,4);assert(trials.every(t=>e.read(t.branch).parent===ws.branch&&e.read(t.branch).fork===ws.revision));
  assert(!s.list('branches').some(b=>b.parent===input.base.branch),'no branches on the sampled conversation');
  x.run(exp.id,1,exp.version);await x.active.get(exp.id)?.done;assert.equal(s.list('experiment-workspaces').length,1,'workspace is created on first run only');
  assert.equal(x.trials(exp.id).filter(t=>e.read(t.branch).parent===ws.branch).length,6);
  // A retrospectively attached trial has no tag but is still a trial.
  let manual=e.create('Manual trial',s.get('revisions',input.base.revision).state,input.base.branch,input.base.revision);
  manual=e.commit(manual.id,manual.head,applyPatch(s.get('revisions',input.base.revision).state,input.conditions[0].patch),'Condition');
  manual=await e.turn(manual.id,manual.head,'Boris');x.attach(exp.id,{condition:'A',branch:manual.id});
  const flagged=x.trialBranches();assert(flagged.has(manual.id));assert(trials.every(t=>flagged.has(t.branch)));assert(!flagged.has(ws.branch));assert(!flagged.has(input.base.branch));
  const app=createApp(e),server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  try {
    const boot=await (await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/bootstrap`)).json() as any;
    assert.equal(boot.branches.find((b:any)=>b.id===manual.id).isTrial,true);assert(!boot.branches.find((b:any)=>b.id===input.base.branch).isTrial);
  } finally { server.close(); }
});
test('experiment and comparison families list roots and order members as a tree by creation time',()=>{
  const F=require('../web/families.js');
  const items=[{id:'c',p:'b',createdAt:'3'},{id:'a',p:null,createdAt:'1'},{id:'b',p:'a',createdAt:'2'},{id:'d',p:'a',createdAt:'4'},{id:'z',p:null,createdAt:'0'},{id:'orphan',p:'gone',createdAt:'5'}];
  const parent=(i:any)=>i.p;
  assert.deepEqual(F.roots(items,parent).map((i:any)=>i.id),['a','z','orphan']);
  assert.deepEqual(F.tree(items,parent,'c').map((t:any)=>[t.item.id,t.depth]),[['a',0],['b',1],['c',2],['d',1]]);
  assert.deepEqual(F.tree(items,parent,'z').map((t:any)=>t.item.id),['z']);
  const s=store(),e=new Engine(s),x=new Experiments(e),input=design(e),one=x.create(input),two=x.branch(one.id,{name:'Two'}),three=x.create({...input,name:'Three'});x.link(three.id,{parent:two.id});
  const list=x.list();assert.deepEqual(F.roots(list,(i:any)=>i.familyParent).map((i:any)=>i.name),['Test']);
  assert.deepEqual(F.tree(list,(i:any)=>i.familyParent,three.id).map((t:any)=>t.item.name),['Test','Two','Three']);
});
test('new rooms default to OpenGateway DeepSeek; demo generates only with ROOM_DEMO=1 and stays editable otherwise',async()=>{
  const s=store(),e=new Engine(s,async()=>{throw Error('must not dispatch');}),state=initialState();
  assert(Object.values(state.characters).every(c=>c.provider==='opengateway'&&c.model==='deepseek/deepseek-flash'));
  const legacy=clone(state);delete legacy.frame;legacy.characters.Boris.provider='demo' as any;let b=e.create('Legacy',legacy);
  b=e.commit(b.id,b.head,{...b.revision.state,system:'Edited'},'Still editable');
  await assert.rejects(e.turn(b.id,b.head,'Boris'),/ROOM_DEMO=1/);assert.equal(s.list('attempts').length,0);
  process.env.ROOM_DEMO='1';try{b=await e.turn(b.id,b.head,'Boris');}finally{delete process.env.ROOM_DEMO;}
  assert(b.revision.state.messages.at(-1)!.text.startsWith('[Demo · Boris]'),'scratch instances keep a free local provider');
});
test('back-and-forth alternates two participants after the opening pick and records the rule',async()=>{
  const s=store(),e=new Engine(s,async()=>response('Fine.'));let b=e.create('Duo');
  b=e.commit(b.id,b.head,{...b.revision.state,participants:['Boris','Ilya']},'Two');
  const run={id:'r',count:4,mode:'alternate' as const};
  for(let index=1;index<=4;index++)b=await e.turn(b.id,b.head,index===1?'Ilya':undefined,{...run,index});
  assert.deepEqual(b.revision.state.messages.map(m=>m.speaker),['Ilya','Boris','Ilya','Boris']);
  const picks=s.list('selections').sort((a,b)=>a.run.index-b.run.index);
  assert.deepEqual(picks.map(p=>p.method),['forced','random','random','random']);assert(picks.slice(1).every(p=>p.eligible.length===1&&p.run.mode==='alternate'));
  await assert.rejects(e.turn(b.id,b.head,'Boris',{...run,index:2}),/Back-and-forth/);
  const trio=e.commit(b.id,b.head,{...b.revision.state,participants:['Boris','Ilya','Rook']},'Three');
  await assert.rejects(e.turn(trio.id,trio.head,undefined,{...run,index:1}),/exactly two/);
});
import { buildSpeakerInput } from '../src/speakerTurn';
test('the human joins the prompt roster only after speaking; once present the prompt is unchanged',async()=>{
  const s=store();let user='';const e=new Engine(s,async(_u,opts)=>{user=JSON.parse(String(opts?.body)).messages[1].content;return response('Fine.');});
  let b=e.create('Quiet human');b=e.commit(b.id,b.head,{...b.revision.state,participants:['Boris','Ilya'],human:'Deniz'},'Two');
  b=await e.turn(b.id,b.head,'Boris');assert(user.includes('Current participants: Boris, Ilya.'));assert(!user.includes('Deniz'));
  b=e.message(b.id,b.head,'Hi both');b=await e.turn(b.id,b.head,'Ilya');
  const transcript=b.revision.state.messages.slice(0,-1).map(m=>`${m.speaker}: ${m.text}`).join('\n');
  assert.equal(user,buildSpeakerInput('Ilya',transcript,['Boris','Ilya']).replace('Current participants: Dennis,','Current participants: Deniz,'),'byte-identical to the previous roster once the human has spoken');
});

import { DEFAULT_FRAME } from '../src/speakerTurn';
import { applyPatch } from '../src/workbench/experiments';
import { stateChanges } from '../src/workbench/changes';
test('harness framing: the default frame is byte-identical, blank parts are dropped, experiments can patch it',async()=>{
  const s=store();let body:any;const e=new Engine(s,async(_u,opts)=>{body=JSON.parse(String(opts?.body));return response('Fine.');});
  let b=e.create('Framed');b=e.commit(b.id,b.head,{...b.revision.state,participants:['Boris','Ilya'],human:'Deniz'},'Two');b=e.message(b.id,b.head,'Hi {speaker}');
  const plain=e.fork(b.id,b.head,'plain');await e.turn(plain.id,plain.head,'Boris');const before=body.messages;
  const framed=e.fork(b.id,b.head,'framed'),withFrame=e.commit(framed.id,framed.head,{...framed.revision.state,frame:{...DEFAULT_FRAME}},'Frame');
  await e.turn(withFrame.id,withFrame.head,'Boris');assert.deepEqual(body.messages,before,'an explicit default frame sends the same request');
  assert(before[1].content.includes('Hi {speaker}'),'placeholders inside the conversation are not expanded');
  const bare=e.commit(framed.id,e.read(framed.id).head,{...e.read(framed.id).revision.state,system:'',frame:{identity:'',context:'{transcript}',opening:'',turn:''},characters:{...b.revision.state.characters,Ilya:{...b.revision.state.characters.Ilya,prompt:''}}},'Bare');
  await e.turn(bare.id,bare.head,'Ilya');
  assert.equal(body.messages.length,1,'an empty system prompt is not sent');assert.equal(body.messages[0].role,'user');
  assert(!/turn|identity|participants/i.test(body.messages[0].content));assert(body.messages[0].content.startsWith('"Deniz: Hi {speaker}'));
  const empty=e.create('Empty');const blank=e.commit(empty.id,empty.head,{...empty.revision.state,system:'',frame:{identity:'',context:'',opening:'',turn:''},characters:{...empty.revision.state.characters,Boris:{...empty.revision.state.characters.Boris,prompt:''}}},'Blank');
  await assert.rejects(e.turn(blank.id,blank.head,'Boris'),/Nothing to send/);
  assert.throws(()=>e.commit(blank.id,blank.head,{...blank.revision.state,frame:{identity:''} as any},'Bad'),/harness framing/);
  const patched=applyPatch(b.revision.state,{frame:{...DEFAULT_FRAME,turn:''}});assert.equal(patched.frame!.turn,'');
  assert.deepEqual(stateChanges(b.revision.state,patched).settings.map(x=>x.field),['frame']);
});

import { saveAttachment, getAttachments, attachmentTranscript, attachmentCapabilities, MAX_FILE_BYTES } from '../src/workbench/attachments';
import { execFileSync } from 'node:child_process';
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG0YAAAAASUVORK5CYII=','base64');
test('attachments preserve original bytes and extracted text, validate files, and never truncate documents',async()=>{
  const s=store(),doc=await saveAttachment(s,'notes.md',Buffer.from('# Room\nA quoted document.'));
  assert.equal(doc.kind,'document');assert.equal(s.get('attachments',doc.id).text,'# Room\nA quoted document.');assert.equal(Buffer.from(s.get('attachments',doc.id).data,'base64').toString(),'# Room\nA quoted document.');
  const image=await saveAttachment(s,'image.png',pixel);assert.equal(image.mime,'image/png');assert.equal(image.size,pixel.length);
  for(const [name,bytes] of [['../escape.txt',Buffer.from('no')],['active.svg',Buffer.from('<svg/>')],['fake.png',Buffer.from('not an image')],['empty.txt',Buffer.alloc(0)],['too-big.txt',Buffer.alloc(MAX_FILE_BYTES+1)],['long.txt',Buffer.from('x'.repeat(100001))],['binary.txt',Buffer.from([0,255,1])]] as [string,Buffer][])await assert.rejects(saveAttachment(s,name,bytes));
  assert.throws(()=>getAttachments(s,[doc.id,doc.id]),/different/);assert.throws(()=>getAttachments(s,['missing']),/missing/);
  assert.equal(s.list('attachments').length,2);
});
test('attached documents and images reach generation, survive identity retries, and stay in forks and comparisons',async()=>{
  const s=store();let calls=0;
  const e=new Engine(s,async(_url,opts)=>{
    const body=JSON.parse(String(opts?.body)),content=body.messages.at(-1).content;assert(Array.isArray(content));
    assert(content.some((p:any)=>p.type==='text'&&p.text.includes('Document facts: blue square.')));
    assert.equal(content.find((p:any)=>p.type==='image_url').image_url.url,'data:image/png;base64,'+pixel.toString('base64'));
    assert.equal(s.attempts().length,++calls,'request on disk before dispatch');
    if(calls===2)assert(content.some((p:any)=>p.type==='text'&&p.text.includes('previous attempt')));
    return response(calls===1?'Elorin: Wrong label.':'Boris: I can discuss the attached files.');
  });
  const image=await saveAttachment(s,'square.png',pixel),doc=await saveAttachment(s,'facts.txt',Buffer.from('Document facts: blue square.'));
  let b=e.create('File room');b=e.message(b.id,b.head,'',[doc.id,image.id]);const original=b;
  b=await e.turn(b.id,b.head,'Boris');assert.equal(calls,2);
  for(const a of s.attempts()){assert.equal(a.attachments.length,2);assert(a.attachments.some((a:any)=>a.input==='image'));}
  const fork=e.fork(b.id,b.head,'With files');assert.deepEqual(fork.revision.state.messages[0].attachments,[doc.id,image.id]);
  const other=e.create('Other'),pair=new Comparisons(e).save({name:'File comparison',left:b.id,right:other.id});assert.deepEqual(e.read(pair.left).revision.state.messages[0].attachments,[doc.id,image.id]);
  const retcon=e.retcon(b.id,b.head,original.revision.state.messages[0].id,'Different caption','keep','keep');assert.deepEqual(retcon.revision.state.messages[0].attachments,[doc.id,image.id]);
  let deleted=e.deleteMessage(retcon.id,retcon.head,retcon.revision.state.messages[0].id);const d=deleted.head;assert(!attachmentTranscript(s,deleted.revision.state.messages,true).parts.length);
  deleted=e.restoreMessage(deleted.id,deleted.head,d);assert.deepEqual(deleted.revision.state.messages[0].attachments,[doc.id,image.id]);
});
test('image provider failures remain errors, with no text-only fallback',async()=>{
  const s=store(),image=await saveAttachment(s,'picture.png',pixel);let calls=0;
  const e=new Engine(s,async()=>{calls++;return new Response('vision not supported',{status:400});});
  let b=e.create();b=e.message(b.id,b.head,'Describe',[image.id]);await assert.rejects(e.turn(b.id,b.head,'Boris'),/did not omit/);
  assert.equal(calls,1);assert.equal(s.attempts()[0].outcome.raw,'vision not supported');assert.equal(e.read(b.id).revision.state.messages.length,1);
});
test('context limits fail before generation or shadow calls; Jev gets document text and image availability markers',async()=>{
  const s=store(),image=await saveAttachment(s,'picture.png',pixel),doc=await saveAttachment(s,'large.txt',Buffer.from('x'.repeat(100000)));
  const e=new Engine(s,async()=>{throw Error('Must not call provider');});let b=e.create();b.revision.state.shadow=true;b=e.commit(b.id,b.head,b.revision.state,'Shadow on');
  for(let i=0;i<3;i++)b=e.message(b.id,b.head,'',[doc.id]);await assert.rejects(e.turn(b.id,b.head,'Boris'),/200,000/);assert.equal(s.attempts().length,0);assert.equal(s.list('jev-requests').length,0);
  const context=attachmentTranscript(s,[{id:'m',speaker:'Dennis',text:'look',source:'human',attachments:[image.id]}]);assert(!context.parts.length);assert(context.transcript.includes('pixels not available'));
});
test('attachment HTTP upload, download, history edit and export preserve evidence without provider calls',async()=>{
  const e=new Engine(store(),async()=>{throw Error('No provider calls');}),server=createApp(e).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const origin=`http://127.0.0.1:${(server.address() as any).port}`;
  const post=async(url:string,body:any)=>{const r=await fetch(origin+'/api'+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,value:await r.json() as any};};
  try {
    const r=await fetch(origin+'/api/attachments',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Room-Filename':encodeURIComponent('Research notes.txt')},body:'Visible file facts'});assert.equal(r.status,200);const file:any=await r.json();
    const b=e.create(),sent=(await post('/branches/'+b.id+'/messages',{expected:b.head,text:'',attachments:[file.id]})).value;assert.equal(sent.revision.state.messages.length,1);
    const stale=await post('/branches/'+b.id+'/messages',{expected:b.head,text:'Retry',attachments:[file.id]});assert.equal(stale.status,400);
    const text=await fetch(origin+'/api/attachments/'+file.id);assert.equal((await text.json() as any).text,'Visible file facts');
    const download=await fetch(origin+'/api/attachments/'+file.id+'/file');assert.equal(await download.text(),'Visible file facts');assert(download.headers.get('content-disposition')?.startsWith('attachment'));
    const exported:any=await (await fetch(origin+'/api/branches/'+b.id+'/export')).json();assert.equal(exported.attachments[0].data,Buffer.from('Visible file facts').toString('base64'));
    const edited=(await post('/branches/'+b.id+'/history',{expected:sent.head,memory:'keep',messages:[{id:sent.revision.state.messages[0].id,speaker:'Dennis',text:'New caption'}]})).value;assert.deepEqual(edited.revision.state.messages[0].attachments,[file.id]);
    const foreign=await fetch(origin+'/api/attachments',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/octet-stream','X-Room-Filename':'bad.txt'},body:'blocked'});assert.equal(foreign.status,403);assert.equal(e.store.list('attachments').length,1);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('native document extraction reads PDF and Word text when tools are available',async(t)=>{
  const s=store(),caps=attachmentCapabilities();
  if(caps.pdf){
    const content='BT /F1 12 Tf 72 720 Td (PDF attachment facts) Tj ET';
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
    let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});const start=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
    const file=await saveAttachment(s,'facts.pdf',Buffer.from(pdf));assert(s.get('attachments',file.id).text.includes('PDF attachment facts'));
  }else t.diagnostic('PDF extraction unavailable on this test host');
  if(caps.docx){const source=path.join(s.root,'source.txt'),out=path.join(s.root,'facts.docx');fs.writeFileSync(source,'Word attachment facts');execFileSync('/usr/bin/textutil',['-convert','docx','-output',out,source]);const file=await saveAttachment(s,'facts.docx',fs.readFileSync(out));assert(s.get('attachments',file.id).text.includes('Word attachment facts'));}
  else t.diagnostic('Word extraction unavailable on this test host');
});
test('image evidence is compact in the inspector while exact request downloads and exports retain pixels',async()=>{
  const s=store(),e=new Engine(s),file=await saveAttachment(s,'photo.png',pixel);let b=e.create();b=e.message(b.id,b.head,'Look',[file.id]);b=await e.turn(b.id,b.head,'Boris');
  const server=createApp(e).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as any).port}/api`;
  try {
    const evidence:any=await (await fetch(base+'/branches/'+b.id)).json(),attempt=evidence.attempts[0];assert(attempt.imageDataSummarized);assert(!JSON.stringify(attempt.body).includes(pixel.toString('base64')));
    const exact:any=await (await fetch(base+'/attempts/'+attempt.id+'/request')).json();assert(JSON.stringify(exact.body).includes(pixel.toString('base64')));
    const exported:any=await (await fetch(base+'/branches/'+b.id+'/export')).json();assert(JSON.stringify(exported.attempts[0].body).includes(pixel.toString('base64')));assert.equal(exported.attachments[0].data,pixel.toString('base64'));
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
import { Alternatives } from '../src/workbench/alternatives';
test('reply alternatives keep the original, generate from its exact request plus feedback, and curate only accepted text',async()=>{
  const s=store(),bodies:any[]=[];let next='I saw the calendars myself.';
  const e=new Engine(s,async(_u,opts)=>{bodies.push(JSON.parse(String(opts?.body)));return response(next);});
  let b=e.create('Revise');b=e.commit(b.id,b.head,{...b.revision.state,participants:['Boris','Ilya']},'Two');
  b=await e.turn(b.id,b.head,'Boris');const original=b.revision.state.messages[0];
  const x=new Alternatives(e);
  b=e.message(b.id,b.head,'Hello');assert.throws(()=>x.open(b.id,b.revision.state.messages[1].id),/original generated reply/);
  const review=x.open(b.id,original.id).review;assert.equal(x.open(b.id,original.id).review.id,review.id,'one review per reply');
  const selections=s.list('selections').length;next='Grounded point, no calendars.';
  let d=await x.propose(review.id,"Don't invent having seen calendars.");
  assert.equal(s.list('selections').length,selections,'alternatives are not speaker selections');
  const sent=bodies.at(-1);assert.deepEqual(sent.messages.slice(0,-1),bodies[0].messages,'original request is reused unchanged');
  assert(sent.messages.at(-1).content.includes("Don't invent having seen calendars."));assert(sent.messages.at(-1).content.includes(JSON.stringify(original.text)));
  const c=d.candidates[0];assert.equal(c.result.status,'completed');assert.equal(c.result.text,'Grounded point, no calendars.');
  assert.throws(()=>x.curate(review.id,{expected:null,candidate:c.id,judgment:null,approved:true,preference:false}),/accepted/);
  d=x.judge(c.id,{expected:null,verdict:'accepted',text:'Grounded point.',note:'trimmed'});const j=d.candidates[0].judgment;
  assert.throws(()=>x.judge(c.id,{expected:null,verdict:'rejected',text:'x'}),/changed/);
  b=x.apply(c.id,{judgment:j.id,expected:e.read(b.id).head});
  const replaced=b.revision.state.messages[0];assert.equal(replaced.text,'Grounded point.');assert.equal(replaced.source,'edited');assert.equal(replaced.review,review.id);assert.deepEqual(replaced.editedFrom,[original.id]);
  assert.equal(b.revision.change?.kind,'replace-message');assert.equal(s.get('revisions',b.revision.parent!).state.messages[0].text,original.text,'earlier revision keeps the original');
  next='Ilya here.';await e.turn(b.id,b.head,'Ilya');assert(!JSON.stringify(bodies.at(-1)).includes('calendars myself')&&!JSON.stringify(bodies.at(-1)).includes("Don't invent"),'feedback and the replaced text never reach later turns');
  d=x.curate(review.id,{expected:null,candidate:c.id,judgment:j.id,approved:true,preference:true});assert(d.approval.current);
  const [sft]=x.export('sft'),[pref]=x.export('preference');
  assert.deepEqual(sft.messages,[...bodies[0].messages,{role:'assistant',content:'Grounded point.'}]);
  assert.deepEqual(pref,{messages:bodies[0].messages,chosen:{role:'assistant',content:'Grounded point.'},rejected:{role:'assistant',content:original.text}});
  x.judge(c.id,{expected:j.id,verdict:'rejected',text:'Grounded point.'});assert.equal(x.dataset().length,0,'a later rejection withdraws the approval');
  s.put('reply-candidates','stale',{id:'stale',review:review.id,feedback:'x',instruction:'x',turnId:'t',at:new Date().toISOString()});x.recover();assert.equal(s.get('reply-candidate-results','stale').status,'interrupted');
});


test('new rooms use transcript-only framing and old rooms retain their original framing',async()=>{
  const s=store();let body:any,calls=0;const e=new ProductionEngine(s,async(_u,opts)=>{calls++;body=JSON.parse(String(opts?.body));return response('Fine.');});
  let b=e.create('Minimal');assert.deepEqual(b.revision.state.frame,{identity:'',context:'{transcript}',opening:'',turn:''});
  await assert.rejects(e.turn(b.id,b.head,'Boris'),/assembled user message is empty/);assert.equal(calls,0);
  b=e.message(b.id,b.head,'Hello {speaker}');await e.turn(b.id,b.head,'Boris');
  assert.equal(body.messages[1].content,JSON.stringify('Dennis: Hello {speaker}'));assert(!body.messages[0].content.includes('Your identity for this request'));
  const legacy=initialState();delete legacy.frame;const old=e.create('Legacy',legacy);await e.turn(old.id,old.head,'Boris');assert(body.messages[0].content.includes('Your identity for this request is Boris'));
});
test('comparison copies keep short names and retcons stay local with immutable history',()=>{
  const s=store(),e=new ProductionEngine(s),c=new Comparisons(e);let b=e.create('Velric · compare copy · retcon · compare copy');b=e.message(b.id,b.head,'Original');
  const right=e.create('Right'),pair=c.save({name:'Pair',left:b.id,right:right.id}),fork=c.fork(pair.id,'Next',pair.version);
  assert.equal(e.read(pair.left).name,'Velric');assert.equal(e.read(fork.left).name,'Velric');
  const pane=e.read(fork.left),message=pane.revision.state.messages[0],count=s.list('branches').length;
  const edited=e.retcon(pane.id,pane.head,message.id,'Edited','keep','keep');assert.equal(edited.id,pane.id);assert.equal(s.list('branches').length,count);
  assert.equal(s.get('revisions',pane.head).state.messages[0].text,'Original');assert.equal(e.read(pair.left).revision.state.messages[0].text,'Original');assert.equal(e.read(b.id).revision.state.messages[0].text,'Original');
  assert.throws(()=>e.retcon(pane.id,pane.head,message.id,'Stale','keep','keep'),/changed/);
  e.active.set(edited.id,{controller:new AbortController(),turnId:'test'});assert.throws(()=>e.retcon(edited.id,edited.head,edited.revision.state.messages[0].id,'Busy','keep','keep'),/Stop generation/);
});

test('readable transcript export includes current prompts, escapes text and excludes research records',async()=>{
  const {transcriptExport}=await import('../src/workbench/transcriptExport');
  const s=store(),e=new ProductionEngine(s);let b=e.create('A <room> · compare copy');
  b=e.message(b.id,b.head,'<script>alert("x")</script>\nSecond line');
  const state=b.revision.state;state.participants=['Boris'];state.system='Shared & grounded';state.characters.Boris.prompt='Boris personality';state.characters.Boris.memory='A remembered point';state.characters.Ilya.prompt='Excluded inactive personality';
  b=e.commit(b.id,b.head,state,'Prompts');s.add('observations',{branch:b.id,text:'PRIVATE RESEARCH NOTE'});
  const html=transcriptExport(b.name,b.revision.state);
  assert(html.includes('A &lt;room&gt;'));assert(!html.includes('compare copy'));assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>alert'));assert(html.includes('Shared &amp; grounded'));assert(html.includes('Boris personality'));assert(html.includes('A remembered point'));assert(html.includes('{transcript}'));assert(!html.includes('Excluded inactive personality'));assert(!html.includes('PRIVATE RESEARCH NOTE'));assert(html.includes('Earlier replies may have used different prompts'));
  const server=createApp(e).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  try {
    const base=`http://127.0.0.1:${(server.address() as any).port}`;
    const page=await fetch(base+`/api/branches/${b.id}/transcript`);assert.equal(page.status,200);assert.match(page.headers.get('content-type')!,/text\/html/);assert.equal(await page.text(),html);
    assert.equal((await fetch(base+'/transcript.css')).status,200);assert.equal((await fetch(base+'/transcript.js')).status,200);
    const json=await (await fetch(base+`/api/branches/${b.id}/export`)).json();assert.equal(json.observations[0].text,'PRIVATE RESEARCH NOTE');
    assert.equal(e.read(b.id).head,b.head);assert.equal(s.list('attempts').length,0);
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
});

// ---- Stage 0: backup and restore (§9.17) ----
import { preflight, backup, verifyRestore, manifest } from '../src/workbench/backup';
import { recoverOnStartup } from '../src/workbench/server';
async function listen(e: ProductionEngine) { const app=createApp(e),server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));return {app,server,base:`http://127.0.0.1:${(server.address() as any).port}`,close:()=>new Promise<void>(r=>server.close(()=>r()))}; }
const json=(body:any)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('backup preflight refuses active work, treats an unreachable API as failed, and pauses mutations while quiesced',async()=>{
  assert.match((await preflight('http://127.0.0.1:9')).reason!,/preflight failed.*unreachable/);
  const e=new ProductionEngine(store()),{base,close}=await listen(e);
  try {
    e.active.set('busy',{controller:new AbortController(),turnId:'t'});
    const refused=await preflight(base);assert.equal(refused.ok,false);assert.match(refused.reason!,/1 active turn/);
    assert.equal((await (await fetch(base+'/api/admin/activity')).json() as any).quiesced,false,'a refused preflight leaves the server unpaused');
    e.active.delete('busy');e.store.put('jev-requests','pending',{id:'pending'});
    assert.match((await preflight(base)).reason!,/shadow/);e.store.put('jev-results','pending',{id:'pending',status:'completed'});
    assert.deepEqual(await preflight(base),{ok:true});
    assert.equal((await fetch(base+'/api/branches',json({}))).status,503);assert.equal(e.store.list('branches').length,0);
    await fetch(base+'/api/admin/quiesce',json({on:false}));
    assert.equal((await fetch(base+'/api/branches',json({}))).status,200);
  } finally { await close(); }
});
test('backup copies offline with a verified manifest, reloads the service, and marks a bad copy INCOMPLETE',async()=>{
  const data=store(),e=new ProductionEngine(data);let b=e.create('Kept');b=e.message(b.id,b.head,'Remember this');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'room-backups-'));roots.push(root);const calls:string[]=[];
  const service={async stop(){calls.push('stop');},async start(){calls.push('start');}};
  const ok=await backup({dataDir:data.root,backupRoot:root,apiBase:'http://127.0.0.1:9',service,appDir:process.cwd(),offlineConfirmed:true,holders:()=>[]});
  assert(ok.ok);assert.deepEqual(calls,['stop','start']);
  assert(!fs.existsSync(path.join(ok.dir!,'INCOMPLETE')));assert.equal(fs.statSync(ok.dir!).mode&0o777,0o700);
  assert.deepEqual(manifest(path.join(ok.dir!,'data')),JSON.parse(fs.readFileSync(path.join(ok.dir!,'manifest.json'),'utf8')));
  const meta=JSON.parse(fs.readFileSync(path.join(ok.dir!,'metadata.json'),'utf8'));assert.equal(meta.status,'complete');assert.match(meta.gitRevision,/^[0-9a-f]{40}$/);
  assert.equal((await backup({dataDir:data.root,backupRoot:root,apiBase:'http://127.0.0.1:9',service,appDir:process.cwd()})).status,'preflight failed');assert.equal(calls.length,2,'no service change without a preflight');
  await new Promise(r=>setTimeout(r,1100));
  const bad=await backup({dataDir:data.root,backupRoot:root,apiBase:'',service,appDir:process.cwd(),offlineConfirmed:true,holders:()=>[],copy:(from,to)=>{fs.cpSync(from,to,{recursive:true});fs.rmSync(path.join(to,'branches'),{recursive:true});}});
  assert.equal(bad.ok,false);assert.equal(bad.status,'INCOMPLETE');assert(fs.existsSync(path.join(bad.dir!,'INCOMPLETE')));assert.equal(calls.at(-1),'start');
  assert.equal((await verifyRestore({backup:bad.dir!,repoDir:process.cwd()})).ok,false);
  const held=await backup({dataDir:data.root,backupRoot:root,apiBase:'',service,appDir:process.cwd(),offlineConfirmed:true,holders:()=>[123],waitMs:300});
  assert.equal(held.ok,false);assert.match(held.reason!,/still holds/);assert.equal(calls.at(-1),'start');
});
test('restore verification opens the copy read-only without writing; read-only mode skips recovery and legacy conversion',async()=>{
  const data=store(),e=new ProductionEngine(data);let b=e.create('Restorable');b=e.message(b.id,b.head,'Hello');
  data.put('attempts','orphan',{id:'orphan',branch:b.id,body:{messages:[]}});
  const right=e.create('Other');data.put('comparisons','legacy',{id:'legacy',version:'v',name:'Legacy pair',left:b.id,right:right.id,parent:null,createdAt:'2026-09-22',updatedAt:'2026-09-22'});
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'room-backups-'));roots.push(root);
  const copy=await backup({dataDir:data.root,backupRoot:root,apiBase:'',service:{async stop(){},async start(){}},appDir:process.cwd(),offlineConfirmed:true,holders:()=>[]});
  const report=await verifyRestore({backup:copy.dir!,repoDir:process.cwd(),appDir:process.cwd()});
  assert(report.ok,report.reason);assert.equal(report.rooms,2);assert.equal(report.comparisons,1);
  const ro=new Store(data.root,true),before=manifest(data.root),{app,base,close}=await listen(new ProductionEngine(ro));
  try {
    recoverOnStartup(app,ro);
    assert.equal((await fetch(base+'/api/comparisons/legacy')).status,200);assert.equal((await fetch(base+'/api/bootstrap')).status,200);
    assert.equal((await fetch(base+'/api/branches',json({}))).status,403);
    assert.throws(()=>ro.put('branches','x',{}),/read-only/);assert.deepEqual(manifest(data.root),before);
  } finally { await close(); }
});

// ---- Stage 1 acceptance (§9) ----
import { scenarios, capture } from './legacyScenarios';
import { Vault, compileV1 } from '../src/workbench/vault';
import { People } from '../src/workbench/people';
import { Runs, statusOf } from '../src/workbench/runs';
import { resolveSpeaker, LEGACY_NAMES } from '../src/workbench/identity';
import { reviseIdentity } from '../src/workbench/alternatives';
import { checkSpeakerReply, WrongSpeakerError, EMPTY_FRAME } from '../src/speakerTurn';
// A recording transport: every provider call is counted, and replies can be scripted per call.
function recorder(script:(n:number,body:any)=>string|Response='Fine.' as any){const calls:any[]=[];const transport=async(_u:any,opts:any)=>{const body=JSON.parse(String(opts?.body));calls.push(body);const r=typeof script==='function'?script(calls.length,body):script;return r instanceof Response?r:new Response(JSON.stringify({choices:[{message:{content:r},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5}}));};return {calls,transport:transport as typeof fetch};}
function world(script?:any){const s=store(),r=recorder(script),e=new ProductionEngine(s,r.transport),vault=new Vault(s),people=new People(e,vault),runs=new Runs(e);vault.seedKinds();return {s,e,vault,people,runs,calls:r.calls};}
function persona(vault:Vault,texts:string[],extra=''){
  const kinds=vault.kinds(),parts=texts.map((text,i)=>vault.create({type:'component',title:'part '+i,content:{text,kind:kinds[i%kinds.length].id}}));
  return {parts,persona:vault.create({type:'persona',title:'the stoic',content:{components:parts.map(p=>({item:p.item.id,revision:p.item.head})),extra}})};
}
const ref=(d:any)=>({item:d.item.id,revision:d.item.head});
const person=(state:any,label:string)=>Object.keys(state.characters).find(k=>(state.characters[k].label??k)===label)!;

test('§9.1 legacy first requests and retries are byte-identical to golden fixtures',async()=>{
  const golden=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/legacy-requests.json'),'utf8'));
  assert.deepEqual(Object.keys(golden),Object.keys(scenarios));
  for(const name of Object.keys(scenarios)){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'room-golden-'));roots.push(dir);assert.deepEqual(await capture(dir,name),golden[name],name);}
});
test('§9.2 legacy collisions and unresolved imported speakers open, export and replay without rewrites',async()=>{
  const {s,e}=world('Fine.'),state=initialState();delete state.frame;state.human='Boris';
  state.messages=[{id:'h',speaker:'Boris',text:'I am the human Boris',source:'human'},{id:'g',speaker:'Boris',text:'I am the character',source:'generated',turnId:'t'},{id:'x',speaker:'Boris',text:'Who wrote this?',source:'edited'},{id:'i',speaker:'Stranger',text:'Unknown voice',source:'imported'},{id:'r',speaker:'Rook',text:'Imported Rook',source:'imported'}];
  const b=e.create('Collision',state),{base,close}=await listen(e);
  try{
    const before=manifest(s.root);
    const opened:any=await (await fetch(base+'/api/branches/'+b.id)).json();
    assert.deepEqual(opened.identity,{h:{kind:'human'},g:{kind:'person',id:'Boris'},x:{kind:'unbound'},i:{kind:'unbound'},r:{kind:'person',id:'Rook'}});
    assert.equal((await fetch(base+'/api/branches/'+b.id+'/export')).status,200);assert.equal((await fetch(base+'/api/branches/'+b.id+'/transcript')).status,200);
    const imported=await (await fetch(base+'/api/import',json({id:'save',history:['Dennis: hi','Somebody: odd','Boris: hello'],participants:['Boris']}))).json() as any;
    const after=manifest(s.root),changed=after.filter(f=>before.some(x=>x.path===f.path&&x.sha256!==f.sha256));assert.deepEqual(changed,[],'opening and exporting rewrite nothing');
    assert.deepEqual(Object.values((await (await fetch(base+'/api/branches/'+imported.id)).json() as any).identity),[{kind:'human'},{kind:'unbound'},{kind:'person',id:'Boris'}]);
    const replay=e.fork(b.id,b.head,'Replay');await e.turn(replay.id,replay.head,'Ilya');assert.equal(s.get('revisions',b.head).state.messages.length,5);
  }finally{await close();}
});
test('§9.3 legacy experiments reopen with their evidence; a new experiment measures a non-legacy instance',async()=>{
  const w=world('I vote Elorin.'),{s,vault,people}=w,e=new Engine(s,recorder('I vote Elorin.').transport),x=new Experiments(e);
  const input=design(e);input.conditions[1].patch={frame:{...DEFAULT_FRAME,turn:''},human:'Moderator'} as any;
  const exp=x.create(input);x.run(exp.id,1,exp.version);await x.active.get(exp.id)?.done;
  // Strip the identity fields new attempts carry, so the records look like Exp1–5 / B-series evidence on disk.
  for(const a of s.list('attempts')){for(const k of ['personId','labelAtDispatch','validationRoster','assemblyVersion'])delete a[k];s.put('attempts',a.id,a);}
  let d=x.detail(exp.id);assert.equal(d.trials.length,2);assert(d.trials.every((t:any)=>t.status==='completed'&&t.effectiveOutcome==='Elorin'&&t.reply==='I vote Elorin.'));
  let manual=e.fork(input.base.branch,input.base.revision,'B-style attached');manual=await e.turn(manual.id,manual.head,'Boris');x.attach(exp.id,{condition:'A',branch:manual.id});
  assert.equal(x.detail(exp.id).trials.length,3);
  const {persona:p}=persona(vault,['steady']);let room=people.createRoom({name:'New'});room=people.add(room.id,{expected:room.head,label:'the judge',persona:ref(p)});
  const judge=person(room.revision.state,'the judge');room=e.message(room.id,room.head,'Verdict?');
  const v2={name:'v2',question:'q',prediction:'p',base:{branch:room.id,revision:room.head},speaker:judge,conditions:[{key:'A',label:'Control',control:true,patch:{}},{key:'B',label:'Situation',patch:{characters:{[judge]:{situation:'You are tired.'}}}}],outcome:{pattern:'I vote (\\w+)'}};
  const exp2=x.create(v2);x.run(exp2.id,1,exp2.version);await x.active.get(exp2.id)?.done;
  d=x.detail(exp2.id);assert(d.trials.every((t:any)=>t.status==='completed'));assert.equal(d.conditions[1].character.situation,'You are tired.');
  const sent=s.attempts().filter(a=>a.personId===judge);assert.equal(sent.length,2);assert(sent.every(a=>a.labelAtDispatch==='the judge'&&a.assemblyVersion==='v2'));
  assert(sent.some(a=>a.body.messages[0].content.includes('You are tired.')));
  assert.throws(()=>applyPatch(s.get('revisions',input.base.revision).state,{characters:{Boris:{label:'Judge'}}}),/legacy assembly/);
  assert.equal(applyPatch(s.get('revisions',input.base.revision).state,{assemblyVersion:'v2',characters:{Boris:{label:'Judge'}}}).characters.Boris.label,'Judge');
  assert.throws(()=>applyPatch(room.revision.state,{characters:{[judge]:{origin:{item:'a',revision:'b'}}}} as any),/Unknown character field/);
});
test('§9.4 empty room → add person → generate',async()=>{
  const {s,e,calls}=world('Hello there.'),{base,close}=await listen(e);
  try{
    let b:any=await (await fetch(base+'/api/branches',json({name:'Fresh'}))).json();
    assert.equal(b.revision.state.assemblyVersion,'v2');assert.deepEqual(b.revision.state.characters,{});assert.deepEqual(b.revision.state.participants,[]);
    const refused=await fetch(base+'/api/branches/'+b.id+'/runs',json({expected:b.head,maxTurns:1,policy:{kind:'random'}}));assert.equal(refused.status,400);
    b=await (await fetch(base+'/api/branches/'+b.id+'/people',json({expected:b.head,label:'the host',prompt:'You host.',provider:'opengateway',model:'m',temperature:0.5}))).json();
    b=await (await fetch(base+'/api/branches/'+b.id+'/messages',json({expected:b.head,text:'Welcome?'}))).json();
    const run:any=await (await fetch(base+'/api/branches/'+b.id+'/runs',json({expected:b.head,maxTurns:1,policy:{kind:'random'}}))).json();
    const out:any=await (await fetch(base+'/api/runs/'+run.id+'/turns',json({index:1}))).json();assert.equal(out.status,'attached');assert.equal(out.run.status,'completed');
    const state=e.read(b.id).revision.state,host=person(state,'the host'),reply=state.messages.at(-1)!;
    assert.deepEqual(reply.speakerRef,{kind:'person',id:host});assert.equal(reply.speaker,'the host');assert.deepEqual(state.messages[0].speakerRef,{kind:'human'});
    const a=s.attempts()[0];assert.equal(a.personId,host);assert.deepEqual(a.validationRoster,['the host','Dennis']);assert.equal(a.body.model,'m');assert.equal(calls.length,1);
    assert(!JSON.stringify(calls[0]).includes(host),'person IDs never reach the model');
  }finally{await close();}
});
test('§9.5 two instances of one persona have separate labels, memories and attribution',async()=>{
  const {s,e,vault,people}=world((_n,body)=>'Reply from '+(body.messages[0].content.includes('Memory A')?'A':'B'));
  const {persona:p}=persona(vault,['curious','quick']);let b=people.createRoom({name:'Twins'});
  b=people.add(b.id,{expected:b.head,label:'movie star #1',persona:ref(p)});b=people.add(b.id,{expected:b.head,label:'movie star #2',persona:ref(p),situation:'Arrived late.'});
  const one=person(b.revision.state,'movie star #1'),two=person(b.revision.state,'movie star #2');assert.notEqual(one,two);
  assert.equal(b.revision.state.characters[one].prompt,'curious\n\nquick');assert.equal(b.revision.state.characters[two].prompt,b.revision.state.characters[one].prompt);
  b=people.settings(b.id,{expected:b.head,characters:{[one]:{memory:'Memory A'}}});b=e.message(b.id,b.head,'Hi');
  b=await e.turn(b.id,b.head,one);b=await e.turn(b.id,b.head,two);
  const [m1,m2]=b.revision.state.messages.slice(1);assert.deepEqual([m1.speaker,m1.speakerRef],['movie star #1',{kind:'person',id:one}]);assert.deepEqual([m2.speaker,m2.speakerRef],['movie star #2',{kind:'person',id:two}]);
  assert.equal(m1.text,'Reply from A');assert.equal(m2.text,'Reply from B');assert.equal(b.revision.state.characters[two].memory,'');
  const sys=s.attempts().find(a=>a.personId===two).body.messages[0].content;assert(sys.startsWith('curious\n\nquick\n\nArrived late.'),'v2 order: prompt, situation, then room instructions');
});
test('§9.6 labels with spaces, digits, # and Unicode work end to end; ":" and newlines are rejected; UI escapes labels',async()=>{
  const labels=['movie star #1','Zoë 2','the judge'];let n=0;
  const {s,e,people}=world(()=>++n===1?'Zoë 2: not mine':n===2?'**movie star #1:** mine':'ok');let b=people.createRoom({name:'Labels'});
  for(const label of labels)b=people.add(b.id,{expected:b.head,label});
  for(const bad of ['a:b','two\nlines','',' padded','x'.repeat(81),'tab\there'])assert.throws(()=>people.add(b.id,{expected:b.head,label:bad}),/label/i);
  assert.throws(()=>people.add(b.id,{expected:b.head,label:'ZOË 2'}),/already labeled/);assert.throws(()=>people.add(b.id,{expected:b.head,label:'dennis'}),/your name/);
  b=e.message(b.id,b.head,'Go');b=await e.turn(b.id,b.head,person(b.revision.state,'movie star #1'));
  assert.equal(b.revision.state.messages.at(-1)!.text,'mine');assert.deepEqual(s.attempts().map(a=>a.outcome.status).sort(),['completed','rejected']);
  assert.equal(checkSpeakerReply('Zoë 2','ZOË 2: hi',[...labels,'Dennis']),'hi');assert.throws(()=>checkSpeakerReply('movie star #1','Zoë 2: hi',[...labels,'Dennis']),WrongSpeakerError);
  assert.equal(checkSpeakerReply('a b','a b: hi',['a b','a']),'hi');assert.throws(()=>checkSpeakerReply('a','a b: hi',['a b','a']),/labeled a b/);
  const renamed=people.rename(b.id,person(b.revision.state,'the judge'),{expected:b.head,label:'<img src=x onerror=alert(1)>'});
  const view=require('../web/changes-view.js'),html=view.render(stateChanges(b.revision.state,renamed.revision.state));assert(!html.includes('<img'));assert(html.includes('&lt;img'));
  const jev=require('../web/jev-view.js').render({turnId:'t',speaker:'<b>x</b>'},[{turnId:'t'}],[{id:'t',chosen:'uuid',method:'forced'}],{uuid:'<i>label</i>'});assert(!jev.includes('<i>'));assert(jev.includes('&lt;i&gt;label'));
});
test('§9.7 rename, text-only history edit, delete/restore and Revise keep attribution; Revise uses the original label and roster',async()=>{
  const {s,e,people}=world('First words.'),{base,close}=await listen(e);
  try{
    let b=people.createRoom({name:'Attribution'});b=people.add(b.id,{expected:b.head,label:'Velric'});b=people.add(b.id,{expected:b.head,label:'Ilya'});
    const velric=person(b.revision.state,'Velric');b=e.message(b.id,b.head,'Start');b=await e.turn(b.id,b.head,velric);b=await e.turn(b.id,b.head,velric);
    const [,first,second]=b.revision.state.messages,roster=s.attempts()[0].validationRoster;
    b=people.rename(b.id,velric,{expected:b.head,label:'the judge'});assert.equal(b.revision.state.messages[1].speaker,'Velric','lines keep the label they were written under');
    const rows=b.revision.state.messages.map(m=>({id:m.id,speaker:m.speaker,text:m.id===first.id?'Edited words.':m.text}));
    b=await (await fetch(base+'/api/branches/'+b.id+'/history',json({expected:b.head,memory:'keep',messages:rows}))).json() as any;
    const edited=b.revision.state.messages[1];assert.equal(edited.text,'Edited words.');assert.deepEqual(edited.speakerRef,{kind:'person',id:velric});assert.equal(edited.speaker,'Velric');
    const retyped=b.revision.state.messages.map((m:any)=>({id:m.id,speaker:m.id===edited.id?'Ilya':m.speaker,text:m.text}));
    const typed=await (await fetch(base+'/api/branches/'+b.id+'/history',json({expected:b.head,memory:'keep',messages:retyped}))).json() as any;
    assert.deepEqual(typed.revision.state.messages[1].speakerRef,{kind:'unbound'},'a retyped label never silently reassigns identity');
    const explicit=typed.revision.state.messages.map((m:any,i:number)=>({id:m.id,speaker:m.speaker,text:m.text,...(i===1?{speakerRef:{kind:'person',id:person(typed.revision.state,'Ilya')}}:{})}));
    b=await (await fetch(base+'/api/branches/'+b.id+'/history',json({expected:typed.head,memory:'keep',messages:explicit}))).json() as any;
    assert.equal(b.revision.state.messages[1].speaker,'Ilya');assert.equal(stateChanges(typed.revision.state,b.revision.state).identity.length,1);
    b=e.deleteMessage(b.id,b.head,second.id);const del=b.head;b=e.restoreMessage(b.id,b.head,del);assert.deepEqual(b.revision.state.messages.at(-1)!.speakerRef,{kind:'person',id:velric});
    const x=new Alternatives(e),review=x.open(b.id,second.id).review;await x.propose(review.id,'Shorter.');
    const cand=s.attempts().find(a=>a.purpose==='alternative');assert.equal(cand.labelAtDispatch,'Velric');assert.deepEqual(cand.validationRoster,roster);assert.equal(cand.personId,velric);
    assert(cand.body.messages.at(-1).content.includes("Revise only Velric's reply"));
    assert.deepEqual(reviseIdentity({persona:'Boris'}),{personId:'Boris',labelAtDispatch:'Boris',validationRoster:LEGACY_NAMES,assemblyVersion:'legacy-v1'});
  }finally{await close();}
});
test('§9.8 people added, deactivated and removed across retcons and comparisons; memory follows identity in all four modes',()=>{
  const {e,people}=world();let b=people.createRoom({name:'Memory'});b=people.add(b.id,{expected:b.head,label:'A'});b=people.add(b.id,{expected:b.head,label:'B'});
  const st=()=>e.read(b.id).revision.state,A=person(st(),'A'),B=person(st(),'B');
  b=people.settings(b.id,{expected:b.head,characters:{[A]:{memory:'a1'},[B]:{memory:'b1'}}});b=e.message(b.id,b.head,'Checkpoint');const msg=b.revision.state.messages[0].id;
  b=people.add(b.id,{expected:b.head,label:'C'});const C=person(st(),'C');b=people.participation(b.id,B,{expected:b.head,active:false});
  b=people.settings(b.id,{expected:b.head,characters:{[A]:{memory:'a2'},[C]:{memory:'c2'}}});b=e.message(b.id,b.head,'Later');
  const expect:any={'regenerate/restore':{people:[A,B],active:[A,B],memory:{[A]:'a1',[B]:'b1'}},'regenerate/keep':{people:[A,B],active:[A,B],memory:{[A]:'a2',[B]:'b1'}},
    'keep/restore':{people:[A,B,C],active:[A,C],memory:{[A]:'a1',[B]:'b1',[C]:'c2'}},'keep/keep':{people:[A,B,C],active:[A,C],memory:{[A]:'a2',[B]:'b1',[C]:'c2'}}};
  for(const [key,want] of Object.entries(expect)){const [mode,memory]=key.split('/');const f=e.fork(b.id,b.head,key);const r=e.retcon(f.id,f.head,msg,'Changed checkpoint',mode,memory).revision.state;
    assert.deepEqual(Object.keys(r.characters),want.people,key);assert.deepEqual(r.participants,want.active,key);assert.deepEqual(Object.fromEntries(Object.entries(r.characters).map(([k,c])=>[k,c.memory])),want.memory,key);}
  const other=people.createRoom({name:'Other'}),pair=new Comparisons(e).save({name:'Pair',left:b.id,right:other.id});
  const pane=e.read(pair.left);people.participation(pane.id,C,{expected:pane.head,active:false});assert.deepEqual(e.read(b.id).revision.state.participants,[A,C]);
  const ch=stateChanges(e.read(b.id).revision.state,e.read(pair.left).revision.state);assert.deepEqual(ch.people.deactivated,[C]);
  assert.throws(()=>people.participation(b.id,'missing',{expected:e.read(b.id).head,active:false}),/Unknown person/);
});
test('§9.9 a narrator opening does not put the human in the roster; a human opening does',async()=>{
  const {vault,people,e,calls}=world(),{persona:p}=persona(vault,['calm']);
  const frame={...DEFAULT_FRAME};
  for(const kind of ['narrator','human']){
    const t=vault.create({type:'room-template',title:'dinner party',content:{system:'Dinner.',frame,flow:'random',opening:{kind,text:'The soup arrives.'},cast:[{persona:ref(p),label:'the host'},{persona:ref(p),label:'the guest',situation:'Owes the host money.'}]}});
    const b=people.createRoom({name:kind,template:ref(t)}),st=b.revision.state;
    assert.equal(st.messages.length,1);assert.deepEqual(st.messages[0].speakerRef,{kind});assert.equal(st.messages[0].speaker,kind==='human'?'Dennis':'Narrator');
    await e.turn(b.id,b.head,person(st,'the host'));const user=calls.at(-1).messages[1].content;
    assert(user.includes(kind==='human'?'Current participants: Dennis, the host, the guest.':'Current participants: the host, the guest.'),kind);
    assert(user.includes(kind==='human'?'Dennis: The soup arrives.':'Narrator: The soup arrives.'));
  }
});
test('§9.10 revising a component changes nothing downstream until adopted; adoption on one branch leaves siblings unchanged',async()=>{
  const {s,e,vault,people,calls}=world(),{parts,persona:p}=persona(vault,['old trait','voice']);
  let b=people.createRoom({name:'Adopt'});b=people.add(b.id,{expected:b.head,label:'the stoic',persona:ref(p)});const stoic=person(b.revision.state,'the stoic');
  const sibling=e.fork(b.id,b.head,'Sibling'),snapshot=JSON.stringify(e.read(b.id).revision.state);
  const revised=vault.revise(parts[0].item.id,{expected:parts[0].item.head,content:{text:'new trait'}});
  assert.equal(JSON.stringify(e.read(b.id).revision.state),snapshot);assert.equal(vault.item(p.item.id).head,p.item.head);
  assert.equal(people.status(e.read(b.id).revision.state)[stoic].updateAvailable,false);
  assert.deepEqual(vault.detail(p.item.id).updates.map((u:any)=>u.item),[parts[0].item.id]);
  const p2=vault.revise(p.item.id,{expected:p.item.head,content:{...p.current.content,components:[ref(revised),ref(parts[1])],compiled:undefined}});
  assert.equal(p2.current.content.compiled,'new trait\n\nvoice');assert.equal(people.status(e.read(b.id).revision.state)[stoic].updateAvailable,true);
  const preview=people.previewPersona(b.id,stoic,{persona:ref(p2)});assert.equal(preview.diverged,false);assert.deepEqual(Object.keys(preview.fields),['prompt','origin']);
  b=people.adoptPersona(b.id,stoic,{expected:b.head,persona:ref(p2)});assert.equal(b.revision.state.characters[stoic].prompt,'new trait\n\nvoice');assert.equal(b.revision.adoption!.kind,'persona');
  assert.equal(e.read(sibling.id).revision.state.characters[stoic].prompt,'old trait\n\nvoice');assert.equal(people.status(e.read(sibling.id).revision.state)[stoic].updateAvailable,true);
  assert.equal(calls.length,0);assert.equal(s.list('attempts').length,0);
});
test('§9.11 template adoption changes only opted-in fields; locally modified values and diverged prompts need replace-or-cancel',()=>{
  const {e,vault,people}=world(),{persona:p}=persona(vault,['steady']);
  const t1=vault.create({type:'room-template',title:'court',content:{system:'S1',frame:{...EMPTY_FRAME},flow:'random',cast:[{persona:ref(p),label:'the judge'},{persona:ref(p),label:'the clerk'}]}});
  let b=people.createRoom({name:'Court',template:ref(t1)});const judge=person(b.revision.state,'the judge');
  b=people.settings(b.id,{expected:b.head,system:'local rules',characters:{[judge]:{memory:'kept',prompt:'edited here'}}});
  const t2=vault.revise(t1.item.id,{expected:t1.item.head,content:{...t1.current.content,system:'S2',frame:{...DEFAULT_FRAME},flow:'alternate'}});
  assert.deepEqual(people.templateStatus(b.revision.state).system,{...b.revision.state.templateFields!.system,diverged:true,updateAvailable:true});
  const pv=people.previewTemplate(b.id,{template:ref(t2)});assert.equal(pv.fields.system.local,true);assert.equal(pv.fields.frame.local,false);
  b=people.adoptTemplate(b.id,{expected:b.head,template:ref(t2),fields:['frame','flow']});
  assert.deepEqual(b.revision.state.frame,DEFAULT_FRAME);assert.equal(b.revision.state.flow,'alternate');assert.equal(b.revision.state.system,'local rules');
  assert.equal(b.revision.state.templateFields!.frame!.revision,t2.item.head);assert.equal(b.revision.state.templateFields!.system!.revision,t1.item.head);assert.deepEqual(b.revision.adoption!.fields,['frame','flow']);
  assert.throws(()=>people.adoptTemplate(b.id,{expected:b.head,template:ref(t2),fields:['system']}),/changed here/);
  b=people.adoptTemplate(b.id,{expected:b.head,template:ref(t2),fields:['system'],replace:true});assert.equal(b.revision.state.system,'S2');assert.equal(b.revision.state.messages.length,0,'the opening and cast are never re-applied');
  assert.equal(b.revision.state.characters[judge].memory,'kept');
  assert.throws(()=>people.adoptPersona(b.id,judge,{expected:b.head,persona:ref(p)}),/Replace it/);
  b=people.adoptPersona(b.id,judge,{expected:b.head,persona:ref(p),replace:true});assert.equal(b.revision.state.characters[judge].prompt,'steady');assert.equal(b.revision.state.characters[judge].memory,'kept');
  b=people.participation(b.id,judge,{expected:b.head,active:false});assert.equal(b.revision.state.flow,'random');assert.match(b.revision.reason,/reset to random/);
});
test('§9.12 archived components still compile; wrong items, wrong kinds and mismatched compiled text are rejected',()=>{
  const {vault}=world(),{parts,persona:p}=persona(vault,['  a  ','b']);
  const blank=vault.create({type:'component',title:'blank',content:{text:'   '}});
  vault.archive(parts[0].item.id,{expected:parts[0].item.version,archived:true});
  const p2=vault.create({type:'persona',title:'again',content:{components:[ref(parts[0]),ref(blank),ref(parts[1])],extra:' x '}});
  assert.equal(p2.current.content.compiled,'a\n\nb\n\nx');assert.equal(compileV1([],''),'');assert.equal(vault.detail(p2.item.id).item.archived,false);
  assert.equal(vault.create({type:'persona',title:'empty',content:{components:[]}}).current.content.compiled,'');
  assert.throws(()=>vault.create({type:'persona',title:'x',content:{components:[{item:parts[1].item.id,revision:parts[0].item.head}]}}),/another item/);
  assert.throws(()=>vault.create({type:'persona',title:'x',content:{components:[ref(p)]}}),/not a component/);
  assert.throws(()=>vault.create({type:'persona',title:'x',content:{components:[ref(parts[1])],compiled:'forged'}}),/compiled/);
  assert.throws(()=>vault.create({type:'component',title:'x',content:{text:'t',kind:'nope'}}),/kind/);
  const k=vault.kinds()[0],renamed=vault.reviseKind(k.id,{expected:k.head,name:'archetype (renamed)',description:'',examples:[]});assert.equal(renamed.id,k.id);
  assert.equal(vault.revision(parts[0].item.head).content.kind,k.id,'renaming a kind keeps references');
});
test('§9.13 a fresh data directory starts with an empty vault and new rooms are v2',async()=>{
  const e=new ProductionEngine(store()),{base,close}=await listen(e);
  try{
    const v:any=await (await fetch(base+'/api/vault')).json();assert.deepEqual(v.items,[]);
    const b:any=await (await fetch(base+'/api/branches',json({name:'New'}))).json();assert.equal(b.revision.state.assemblyVersion,'v2');assert.equal(Object.keys(b.revision.state.characters).length,0);
    const vault=new Vault(e.store);vault.seedKinds();assert.equal(vault.kinds().length,8);assert.deepEqual(vault.list(),[]);vault.seedKinds();assert.equal(vault.kinds().length,8);
  }finally{await close();}
});
test('§9.14 stale expected heads are rejected for vault items, kinds and rooms',()=>{
  const {vault,people}=world(),{parts}=persona(vault,['x']);const c=parts[0];
  vault.revise(c.item.id,{expected:c.item.head,content:{text:'y'}});
  assert.throws(()=>vault.revise(c.item.id,{expected:c.item.head,content:{text:'z'}}),/changed/);assert.throws(()=>vault.archive(c.item.id,{expected:c.item.head,archived:true}),/changed/);
  const k=vault.kinds()[0];vault.reviseKind(k.id,{expected:k.head,name:'n'});assert.throws(()=>vault.reviseKind(k.id,{expected:k.head,name:'m'}),/changed/);
  let b=people.createRoom({name:'Stale'});const old=b.head;b=people.add(b.id,{expected:b.head,label:'A'});
  for(const fn of [()=>people.add(b.id,{expected:old,label:'B'}),()=>people.rename(b.id,person(b.revision.state,'A'),{expected:old,label:'C'}),()=>people.settings(b.id,{expected:old,system:'x'}),()=>people.participation(b.id,person(b.revision.state,'A'),{expected:old,active:false})])assert.throws(fn,/changed/);
});
test('§9.15 runs: one generation per index, Stop is final, browser loss and restarts interrupt, one advancing run per branch',async()=>{
  let release:()=>void=()=>{};const gate=()=>new Promise<void>(r=>release=r);let hold:Promise<void>|null=null;
  const {s,e,people,runs,calls}=world(()=>'Line.');
  const slow=new ProductionEngine(s,async(u,o)=>{if(hold)await hold;return recorder(()=>'Line.').transport(u,o as any);});
  let b=people.createRoom({name:'Runs'});b=people.add(b.id,{expected:b.head,label:'A'});b=people.add(b.id,{expected:b.head,label:'B'});b=e.message(b.id,b.head,'Go');
  const r=runs.start(b.id,{expected:b.head,maxTurns:3,policy:{kind:'alternate'}});assert.equal(s.get('runs',r.id).transitions[0].status,'running','persisted before the first dispatch');
  await runs.advance(r.id,1);const again=await runs.advance(r.id,1);assert.equal(again.duplicate,true);assert.equal(calls.length,1,'resubmitting an index never dispatches');
  await assert.rejects(runs.advance(r.id,3),/consecutive/);
  assert.throws(()=>runs.start(b.id,{expected:e.read(b.id).head,maxTurns:2}),/Another run/);
  runs.stop(r.id);await assert.rejects(runs.advance(r.id,2),/stopped/);assert.equal(calls.length,1);assert.equal(statusOf(runs.get(r.id)),'stopped');
  const u=runs.get(r.id).usage;assert.deepEqual(u,{input:10,output:5,reasoning:0,missing:0});
  // Browser loss: no next turn within the timeout.
  runs.timeoutMs=60;b=e.read(b.id);const lost=runs.start(b.id,{expected:b.head,maxTurns:2});await runs.advance(lost.id,1);await new Promise(r=>setTimeout(r,150));
  assert.equal(statusOf(runs.get(lost.id)),'interrupted');assert.match(runs.get(lost.id).transitions.at(-1)!.reason!,/browser/);runs.timeoutMs=60000;
  // Head moved outside the run.
  b=e.read(b.id);const moved=runs.start(b.id,{expected:b.head,maxTurns:2});people.settings(b.id,{expected:b.head,system:'Changed outside the run'});assert.equal(statusOf(runs.get(moved.id)),'interrupted');
  await assert.rejects(runs.advance(moved.id,1),/interrupted/);
  // Stop while a turn is in flight: the late reply is canceled, never attached.
  const slowRuns=new Runs(slow);b=e.read(b.id);const inflight=slowRuns.start(b.id,{expected:b.head,maxTurns:2,policy:{kind:'fixed',speaker:person(b.revision.state,'A')}});
  hold=gate();const pending=slowRuns.advance(inflight.id,1);await new Promise(r=>setTimeout(r,20));
  assert.equal((await slowRuns.advance(inflight.id,1)).status,'pending');slowRuns.stop(inflight.id);release();hold=null;const done=await pending;
  assert.equal(done.status,'canceled');assert.equal(statusOf(slowRuns.get(inflight.id)),'stopped');assert.equal(e.read(b.id).head,b.head);
  // Missing provider usage is counted, not zeroed.
  const noUsage=new ProductionEngine(s,async()=>new Response(JSON.stringify({choices:[{message:{content:'No usage.'}}]})));const nr=new Runs(noUsage);b=e.read(b.id);
  const m=nr.start(b.id,{expected:b.head,maxTurns:1});const fin=await nr.advance(m.id,1);assert.equal(fin.run.status??statusOf(fin.run),'completed');assert.deepEqual(nr.get(m.id).usage,{input:0,output:0,reasoning:0,missing:1});
  // Restart: a running run is interrupted, never resumed.
  b=e.read(b.id);const left=runs.start(b.id,{expected:b.head,maxTurns:5});new Runs(new ProductionEngine(new Store(s.root))).recover();assert.equal(statusOf(runs.get(left.id)),'interrupted');
  // Two tabs on one branch: the second start is refused while the first is advancing.
  b=e.read(b.id);const tab1=runs.start(b.id,{expected:b.head,maxTurns:2});assert.throws(()=>runs.start(b.id,{expected:b.head,maxTurns:2}),/Another run/);runs.stop(tab1.id);
  assert.throws(()=>runs.start(b.id,{expected:b.head,maxTurns:21}),/1–20/);
});
test('§9.16 creating, revising, composing, previewing, instantiating, adopting, renaming and opening make zero provider calls',async()=>{
  const {s,e,calls}=world(),{base,close}=await listen(e);
  const post=async(url:string,body:any)=>{const r=await fetch(base+'/api'+url,json(body));const v:any=await r.json();assert.equal(r.status,200,url+': '+v.error);return v;};
  try{
    const kinds=(await post('/vault-kinds',{name:'trait',description:'d'}));
    const c1=await post('/vault',{type:'component',title:'one',content:{text:'one',kind:kinds.id}}),c2=await post('/vault',{type:'component',title:'two',content:{text:'two'}});
    const content={components:[ref(c1),ref(c2)],extra:''};assert.equal((await post('/vault/compile',{type:'persona',content})).compiled,'one\n\ntwo');
    const p=await post('/vault',{type:'persona',title:'p',content});await post('/vault/'+c1.item.id+'/revise',{expected:c1.item.head,content:{text:'one!'}});
    const t=await post('/vault',{type:'room-template',title:'t',content:{system:'s',flow:'random',cast:[{persona:ref(p),label:'X'}]}});
    let b=await post('/branches',{name:'From template',template:ref(t)});
    const preview=await post('/branches/'+b.id+'/people/preview',{label:'Y',persona:ref(p),situation:'here'});assert(preview.assembled.includes('here'));
    b=await post('/branches/'+b.id+'/people',{expected:b.head,label:'Y',persona:ref(p)});const y=person(b.revision.state,'Y');
    await (await fetch(base+'/api/branches/'+b.id+'/people/'+y+'/assembled')).json();
    b=await post('/branches/'+b.id+'/people/'+y+'/rename',{expected:b.head,label:'Z'});
    await post('/branches/'+b.id+'/people/'+y+'/adopt/preview',{persona:ref(p)});await post('/branches/'+b.id+'/template/preview',{template:ref(t)});
    b=await post('/branches/'+b.id+'/template/adopt',{expected:b.head,template:ref(t),fields:['system']});
    for(const url of ['/vault','/vault/'+p.item.id,'/vault/revisions/'+p.item.head,'/branches/'+b.id,'/bootstrap','/vault/'+c1.item.id+'/diff?from='+c1.item.head+'&to='+vault_head(s,c1.item.id)])assert.equal((await fetch(base+'/api'+url)).status,200,url);
    assert.equal(calls.length,0);assert.equal(s.list('attempts').length,0);
  }finally{await close();}
});
function vault_head(s:Store,item:string){return s.get('vault-items',item).head;}

// ---- Review fixes (coordination/2026-10-06/12) ----
async function serve(e:ProductionEngine){const {app,base,close}=await listen(e);const call=async(url:string,body?:any)=>{const r=await fetch(base+'/api'+url,body===undefined?{}:json(body));return {status:r.status,value:await r.json() as any};};return {app,base,close,call};}
function gated(s:Store){let release:()=>void=()=>{};const gates:Promise<void>[]=[];let n=0;const bodies:any[]=[];
  const e=new ProductionEngine(s,async(_u,opts)=>{bodies.push(JSON.parse(String(opts?.body)));const signal=opts?.signal;const i=n++;if(gates[i])await Promise.race([gates[i],new Promise((_r,rej)=>signal?.addEventListener('abort',()=>rej(new DOMException('Canceled','AbortError')),{once:true}))]);return new Response(JSON.stringify({choices:[{message:{content:'Reply '+i+'.'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}}));});
  return {e,bodies,hold:(i:number)=>{gates[i]=new Promise<void>(r=>release=r);},release:()=>release()};}
const tick=(ms=20)=>new Promise(r=>setTimeout(r,ms));
test('fix 1: while a turn is pending, another index is refused before the record changes, and Stop still aborts the pending turn',async()=>{
  const s=store(),g=gated(s),people=new People(g.e,new Vault(s)),runs=new Runs(g.e);
  let b=people.createRoom({name:'Pending'});b=people.add(b.id,{expected:b.head,label:'A'});
  const r=runs.start(b.id,{expected:b.head,maxTurns:3});g.hold(0);const first=runs.advance(r.id,1);await tick();
  await assert.rejects(runs.advance(r.id,2),/still running/);
  const rec=s.get('runs',r.id);assert.equal(rec.turns.length,1);assert.equal(statusOf(rec),'running');assert.equal((await runs.advance(r.id,1)).status,'pending');
  runs.stop(r.id);const out=await first;assert.equal(out.status,'canceled');
  assert.equal(g.e.read(b.id).revision.state.messages.length,0,'the aborted reply never attaches');assert.equal(statusOf(runs.get(r.id)),'stopped');
});
test('fix 2: text-only edits keep legacy attribution when the human name equals a character name',async()=>{
  const {s}=world(),e=new Engine(s,recorder('Character line.').transport),{close,call}=await serve(e);
  try{
    const st=initialState();delete st.frame;st.human='Boris';let b=e.create('Collision',st);
    b=e.message(b.id,b.head,'Human line');b=await e.turn(b.id,b.head,'Boris');
    const [human,generated]=b.revision.state.messages;
    const retconned=e.retcon(b.id,b.head,generated.id,'Character line, edited.','keep','keep');
    assert.deepEqual(retconned.revision.state.messages[1].speakerRef,{kind:'person',id:'Boris'});
    assert.deepEqual(s.get('revisions',b.head).state.messages[1].speakerRef,undefined,'historical records are untouched');
    const edited=(await call('/branches/'+b.id+'/history',{expected:retconned.head,memory:'keep',messages:retconned.revision.state.messages.map((m:any,i:number)=>({id:m.id,speaker:m.speaker,text:i===0?'Human line, edited.':m.text}))})).value;
    assert.deepEqual(edited.revision.state.messages[0].speakerRef,{kind:'human'});assert.deepEqual(edited.revision.state.messages[1].speakerRef,{kind:'person',id:'Boris'});
    // An edit saved before this fix (no speakerRef) is rescued by its generation link.
    const old=clone(b.revision.state);old.messages[1]={...generated,id:'legacy-edit',source:'edited',text:'Edited long ago'};const legacy=e.create('Old edit',old);
    assert.deepEqual((await call('/branches/'+legacy.id)).value.identity['legacy-edit'],{kind:'person',id:'Boris'});
    assert.deepEqual(resolveSpeaker(old,old.messages[1]),{kind:'unbound'},'without provenance it stays unbound');void human;
  }finally{await close();}
});
test('fix 3: archive and restore expect a metadata version, so a stale token is rejected for items and kinds',()=>{
  const {vault}=world(),{parts}=persona(vault,['x']),item=parts[0].item;
  const archived=vault.archive(item.id,{expected:item.version,archived:true});assert.notEqual(archived.item.version,item.version);
  assert.throws(()=>vault.archive(item.id,{expected:item.version,archived:false}),/changed/);assert.equal(vault.item(item.id).archived,true);
  vault.archive(item.id,{expected:archived.item.version,archived:false});
  const k=vault.kinds()[0],k2=vault.archiveKind(k.id,{expected:k.version,archived:true});
  assert.throws(()=>vault.archiveKind(k.id,{expected:k.version,archived:false}),/changed/);assert.equal(vault.kinds().find(x=>x.id===k.id)!.archived,true);
  vault.archiveKind(k.id,{expected:k2.version,archived:false});
  const revised=vault.reviseKind(k.id,{expected:k.head,name:'renamed'});assert.throws(()=>vault.archiveKind(k.id,{expected:k2.version,archived:true}),/changed/);void revised;
});
test('fix 4: empty room → add person → Continue works without a human message, with an inspectable request',async()=>{
  const {e,calls}=world('First words.'),{close,call}=await serve(e);
  try{
    let b=(await call('/branches',{name:'Empty'})).value;assert.equal(b.revision.state.system,'');assert.deepEqual(b.revision.state.frame,DEFAULT_FRAME);
    b=(await call('/branches/'+b.id+'/people',{expected:b.head,label:'the host',prompt:'You host.'})).value;
    const run=(await call('/branches/'+b.id+'/runs',{expected:b.head,maxTurns:1})).value,out=(await call('/runs/'+run.id+'/turns',{index:1})).value;
    assert.equal(out.status,'attached');assert.equal(calls.length,1);
    const user=calls[0].messages.at(-1).content;assert(user.startsWith('The conversation has not started yet.'));assert(!calls[0].messages[0].content.includes('group conversation'),'no legacy room instructions');
    const inspect=(await call('/branches/'+b.id)).value;assert.equal(inspect.attempts.length,1);assert.equal(inspect.attempts[0].body.messages.at(-1).content,user);
  }finally{await close();}
});
test('fix 6: reaction views and exports carry the resolved identity and lineage beside the written label',async()=>{
  const {e,people}=world('Hello.'),{base,close,call}=await serve(e);
  try{
    let b=people.createRoom({name:'Marked'});b=people.add(b.id,{expected:b.head,label:'Velric'});const v=person(b.revision.state,'Velric');
    b=e.message(b.id,b.head,'Hi');b=await e.turn(b.id,b.head,v);const m=b.revision.state.messages[1];const child=e.fork(b.id,b.head,'Child');
    people.rename(child.id,v,{expected:child.head,label:'the judge'});await call('/reactions',{branch:child.id,message:m.id,value:'favorite'});
    const [item]=(await call('/reactions/favorite')).value;
    assert.equal(item.speaker,'Velric');assert.deepEqual(item.speakerRef,{kind:'person',id:v});assert.equal(item.lineage.root,b.id);assert.equal(item.lineage.rootName,'Marked');
    const exported:any=await (await fetch(base+'/api/reactions/favorite/export')).json();assert.deepEqual(exported.items[0].speakerRef,{kind:'person',id:v});assert.equal(exported.items[0].lineage.root,b.id);
  }finally{await close();}
});
test('decision B: a human message continues a run, between turns and during an in-flight turn',async()=>{
  const s=store(),g=gated(s),{app,close,call}=await serve(g.e),people:People=app.locals.people;
  try{
    let b=people.createRoom({name:'Interject'});b=people.add(b.id,{expected:b.head,label:'A'});b=people.add(b.id,{expected:b.head,label:'B'});
    // Between turns.
    let run=(await call('/branches/'+b.id+'/runs',{expected:b.head,maxTurns:2})).value;await call('/runs/'+run.id+'/turns',{index:1});
    let head=g.e.read(b.id).head;assert.equal((await call('/branches/'+b.id+'/messages',{expected:head,text:'Wait, me first.'})).status,200);
    let out=(await call('/runs/'+run.id+'/turns',{index:2})).value;assert.equal(out.status,'attached');assert.equal(out.run.status,'completed');
    assert(out.run.transitions.some((t:any)=>t.event==='human-message'));assert(JSON.stringify(g.bodies.at(-1)).includes('Wait, me first.'));
    // During an in-flight turn: the old-head reply is detached, doesn't count, and the next turn uses the new head.
    head=g.e.read(b.id).head;run=(await call('/branches/'+b.id+'/runs',{expected:head,maxTurns:1})).value;
    g.hold(g.bodies.length);const pending=call('/runs/'+run.id+'/turns',{index:1});await tick(50);
    assert.equal((await call('/branches/'+b.id+'/messages',{expected:head,text:'Interrupting.'})).status,200);g.release();
    out=(await pending).value;assert.equal(out.status,'detached');assert.equal(out.run.status,'running');assert.equal(out.run.uncounted.length,1);
    out=(await call('/runs/'+run.id+'/turns',{index:2})).value;assert.equal(out.status,'attached');assert.equal(out.run.status,'completed');
    const texts=g.e.read(b.id).revision.state.messages.map(m=>m.text);assert.equal(texts.at(-2),'Interrupting.');assert(!texts.includes('Reply 2.'),'the detached reply is not attached');assert.equal(texts.at(-1),'Reply 3.');
    assert(JSON.stringify(g.bodies.at(-1)).includes('Interrupting.'));
    // Any other head change still interrupts.
    head=g.e.read(b.id).head;run=(await call('/branches/'+b.id+'/runs',{expected:head,maxTurns:1})).value;people.settings(b.id,{expected:head,system:'x'});
    assert.equal((await call('/runs/'+run.id)).value.status,'interrupted');
  }finally{await close();}
});
test('decision D: kind seeding finishes an interrupted starter set without duplicates',()=>{
  const s=store(),vault=new Vault(s);vault.createKind({name:'archetype',description:'partial'},'starter-archetype');
  vault.seedKinds();assert.equal(vault.kinds().length,8);assert.equal(vault.kinds().filter(k=>k.name==='archetype').length,1);
  vault.seedKinds();assert.equal(vault.kinds().length,8);assert(fs.existsSync(s.file('vault-meta','starter-kinds')));
});
test('decision E: an already-stopped service stays stopped; restore verification labels matching-version vs newer-code checks',async()=>{
  const data=store(),e=new ProductionEngine(data);e.create('Room');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'room-backups-'));roots.push(root);const calls:string[]=[];
  const out=await backup({dataDir:data.root,backupRoot:root,apiBase:'',service:{async stop(){calls.push('stop');return false;},async start(){calls.push('start');}},appDir:process.cwd(),offlineConfirmed:true,holders:()=>[]});
  assert(out.ok);assert.deepEqual(calls,['stop'],'never started when it was not running');
  assert.equal(JSON.parse(fs.readFileSync(path.join(out.dir!,'metadata.json'),'utf8')).appDir,process.cwd());
  const newer=await verifyRestore({backup:out.dir!,appDir:process.cwd()});assert(newer.ok,newer.reason);assert.equal(newer.mode,'compatibility with newer code');
  const matching=await verifyRestore({backup:out.dir!});assert(matching.ok,matching.reason);assert.equal(matching.mode,'matching-version restore');
});
test('client run driver continues until the server ends the run; polling backs off and survives failures',async()=>{
  const R=require('../web/runs-view.js');const statuses=['running','running','running','completed'];const asked:number[]=[];
  const out=await R.drive(async(n:number)=>{asked.push(n);return {run:{status:statuses[n-1]}};},async()=>{},()=>false);
  assert.deepEqual(asked,[1,2,3,4],'three detached interjection turns, then the counted one');assert.equal(out.run.status,'completed');
  let stop=false;const seen:number[]=[];await R.drive(async(n:number)=>{seen.push(n);if(n===2)stop=true;return {run:{status:'running'}};},async()=>{},()=>stop);assert.deepEqual(seen,[1,2]);
  assert.deepEqual([0,1,2,3,10].map(R.pollDelay),[2000,4000,8000,16000,30000]);
  const rec=(id:string,run:any)=>({branch:{id},run});
  assert.equal(R.shouldPoll([rec('a',{id:'r'})],()=>false),true);assert.equal(R.shouldPoll([rec('a',{id:'r'})],(k:string)=>k==='a'),false);assert.equal(R.shouldPoll([rec('a',null),undefined],()=>false),false);
  // The real client scheduler: a failed refresh leaves a retry timer behind.
  const {runInNewContext}=require('node:vm');const src=fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8');
  const fn=src.slice(src.indexOf('function scheduleRunPoll'),src.indexOf('addEventListener(\'focus\''));
  const timers:any[]=[];const ctx:any={RoomRuns:R,records:new Map([['a',rec('a',{id:'r'})]]),runs:new Map(),comparison:null,current:'a',runPollTimer:null,clearTimeout(){},setTimeout(f:any,ms:number){timers.push({f,ms});return timers.length;},refresh:()=>Promise.reject(Error('offline'))};
  runInNewContext(fn+';scheduleRunPoll();',ctx);assert.equal(timers.length,1);timers[0].f();await tick();
  assert.equal(timers.length,2,'a failed poll reschedules');assert.equal(timers[1].ms,4000);
});

import { assemble, validateState } from '../src/workbench/engine';
import { assertPerspective } from '../src/workbench/history';
import { transcriptCases, captureTranscript, perspectiveCases, perspectiveState, historyState } from './historyScenarios';
// Independent strict transport contract; a malformed perspective sequence must never reach a provider.
function strictHistory(messages:any[]) {
  const d=messages[0]?.role==='system'?messages.slice(1):messages;
  assert(d.length>0);assert.equal(d[0].role,'user');assert.equal(d.at(-1).role,'user');
  d.forEach((m,i)=>{assert.equal(m.role,i%2?'assistant':'user');assert(typeof m.content==='string'?m.content.trim():m.content.some((p:any)=>p.type==='image_url'||p.text.trim()));if(m.role==='assistant'&&Array.isArray(m.content))assert(!m.content.some((p:any)=>p.type==='image_url'));});
}
test('§1.5a.4.1 stage 1 legacy and v2 transcript bodies, custom/blank frames, mixed attachments and retries stay byte-identical',async()=>{
  const golden=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/transcript-requests.json'),'utf8'));
  for(const name of transcriptCases)assert.deepEqual(await captureTranscript(store(),name),golden[name],name);
  const s=store(),state=historyState(s),before=JSON.stringify(state);const absent=assemble(s,state,'Boris').messages;
  state.assembly={history:'transcript'};assert.deepEqual(assemble(s,state,'Boris').messages,absent);delete state.assembly;assert.equal(JSON.stringify(state),before);
});
for(const name of perspectiveCases)test('§1.5a.4.2 perspective golden: '+name,async()=>{
  const s=store(),state=perspectiveState(s,name),golden=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/perspective-requests.json'),'utf8'))[name];
  let calls=0;const e=new ProductionEngine(s,async(_u,o)=>{const body=JSON.parse(String(o?.body));strictHistory(body.messages);assert.deepEqual(body,{model:'mock',messages:golden,temperature:.7});const a=s.attempts()[0];assert.deepEqual(a.body,body);assert.deepEqual(a.assembly,{history:'perspective'});assert.equal(a.adapterVersion,'perspective-1');calls++;return response('Fine.');});
  const b=e.create(name,state),bytes=fs.readFileSync(path.join(s.root,'revisions',b.head+'.json'),'utf8');
  const preview=new People(e,new Vault(s)).previewAssembled(b.id,'alpha');assert.deepEqual(preview.messages,golden);assert.equal(calls,0);assert.deepEqual(assemble(s,{...state,frame:undefined},'alpha').messages,golden);
  await e.turn(b.id,b.head,'alpha');assert.equal(calls,1);assert.equal(fs.readFileSync(path.join(s.root,'revisions',b.head+'.json'),'utf8'),bytes);
});
test('§1.5a.4.3 invalid configs, custom framing and own images fail before character or shadow dispatch',async()=>{
  const s=store();let calls=0;const e=new ProductionEngine(s,async()=>{calls++;throw Error('Must not dispatch');});
  for(const bad of [null,{},[],{history:'unknown'},{history:'perspective',extra:true}]){
    const state=perspectiveState(s,'empty');(state as any).assembly=bad;assert.throws(()=>e.create('Bad',state),/assembly configuration/);
  }
  for(const version of [undefined,'legacy-v1'] as const){const state=initialState();state.assemblyVersion=version;state.assembly={history:'transcript'};assert.throws(()=>e.create('Bad legacy',state),/requires v2/);}
  for(const kind of ['custom','own-image','missing','limit']){
    const state=perspectiveState(s,'own-first');state.shadow=true;
    if(kind==='custom')state.frame={...DEFAULT_FRAME,context:''};
    if(kind==='own-image')state.messages[0].attachments=['img'];
    if(kind==='limit'){s.put('attachments','large',{...s.get('attachments','doc'),id:'large',text:'x'.repeat(200001)});state.messages[0].attachments=['large'];}
    if(kind==='missing')state.messages[0].attachments=['doc'];
    const b=e.create(kind,state);if(kind==='missing')fs.unlinkSync(s.file('attachments','doc'));
    await assert.rejects(e.turn(b.id,b.head,'alpha'),/default framing|own messages|missing|200,000/);
    assert.throws(()=>new People(e,new Vault(s)).previewAssembled(b.id,'alpha'),/default framing|own messages|missing|200,000/);
  }
  assert.equal(calls,0);assert.equal(s.attempts().length,0);assert.equal(s.list('jev-requests').length,0);
  const legacy=initialState(),switched=applyPatch(legacy,{assemblyVersion:'v2',assembly:{history:'perspective'}});assert.deepEqual(switched.assembly,{history:'perspective'});assert.equal(legacy.assembly,undefined);
  assert.throws(()=>applyPatch(switched,{assembly:{} as any}),/configuration/);assert.throws(()=>applyPatch(switched,{assembly:{history:'transcript',extra:1} as any}),/configuration/);assert.deepEqual(applyPatch(switched,{assembly:{history:'transcript'}}).assembly,{history:'transcript'});
});
test('§1.5a.4.4 retry and Revise use saved perspective input after config, prompt, label and vault heads change',async()=>{
  const {s,e,people,vault}=world(),{persona:p}=persona(vault,['Original.']);let b=people.createRoom({name:'Frozen'});
  b=people.add(b.id,{expected:b.head,label:'Alice',persona:ref(p)});b=people.add(b.id,{expected:b.head,label:'Bob',persona:ref(p)});const alpha=person(b.revision.state,'Alice');
  b=people.settings(b.id,{expected:b.head,assembly:{history:'perspective'}});b=e.message(b.id,b.head,'Begin.');
  const firstHead=b.head;let n=0;const bodies:any[]=[];
  e.transport=async(_u,o)=>{const body=JSON.parse(String(o?.body));strictHistory(body.messages);bodies.push(body);n++;if(n===1){let cur=e.read(b.id);cur=people.rename(cur.id,alpha,{expected:cur.head,label:'Changed'});people.settings(cur.id,{expected:cur.head,assembly:{history:'transcript'},characters:{[alpha]:{prompt:'Changed prompt.'}}});vault.revise(p.item.id,{expected:p.item.head,content:{components:p.current.content.components,extra:'New vault head.'}});}return response(n%2?'Bob: wrong.':'Good.');};
  await e.turn(b.id,firstHead,alpha);assert.equal(s.list('turns')[0].status,'detached');
  const correction="The previous attempt used another participant's label. Write a fresh reply only as Alice, from your own perspective.";
  const retried=clone(bodies[0]);retried.messages.at(-1).content+='\n\n'+correction;assert.deepEqual(bodies[1],retried);
  // A fresh branch of the frozen input supplies an attached successful retry to Revise.
  b=e.fork(b.id,firstHead,'Frozen input');b=await e.turn(b.id,b.head,alpha);const original=s.attempts().find(a=>a.branch===b.id&&!a.retryOf)!;
  const x=new Alternatives(e),review=x.open(b.id,b.revision.state.messages.at(-1)!.id).review;assert.equal(review.inputAttempt,original.id);
  b=people.rename(b.id,alpha,{expected:b.head,label:'Later'});b=people.settings(b.id,{expected:b.head,assembly:{history:'transcript'},characters:{[alpha]:{prompt:'Later prompt.'}}});
  const saved=JSON.stringify(original);const result=await x.propose(review.id,'Be concise.'),candidate=result.candidates[0],attempts=s.attempts().filter(a=>a.purpose==='alternative');
  assert.equal(candidate.result.status,'completed');assert.equal(attempts.length,2);
  const base=attempts.find(a=>!a.retryOf)!,retry=attempts.find(a=>a.retryOf)!;const expected=clone(original.body);expected.messages.at(-1).content+='\n\n'+candidate.instruction;
  assert.deepEqual(base.body,expected);assert(candidate.instruction.includes('Earlier reply: "Good."'));assert(candidate.instruction.includes('Feedback: "Be concise."'));
  expected.messages.at(-1).content+='\n\n'+correction;assert.deepEqual(retry.body,expected);assert(!JSON.stringify(expected).includes('\\n\\n\\n\\n'));
  for(const a of attempts){assert.deepEqual(a.assembly,{history:'perspective'});assert.equal(a.adapterVersion,'perspective-1');assert.equal(a.labelAtDispatch,'Alice');assert.deepEqual(a.origin,ref(p));}
  assert.equal(JSON.stringify(s.attempts().find(a=>a.id===original.id)),saved);
});
test('§1.5a.4.5 concurrent transcript and perspective experiment trials record isolated configurations',async()=>{
  const s=store(),state=perspectiveState(s,'cast');delete state.assembly;let pending=0,peak=0;const releases:(()=>void)[]=[];
  const e=new ProductionEngine(s,async(_u,o)=>{const body=JSON.parse(String(o?.body));if(body.messages.length>2)strictHistory(body.messages);pending++;peak=Math.max(peak,pending);await new Promise<void>(r=>releases.push(r));pending--;return response('Trial.');});
  const b=e.create('Base',state),x=new Experiments(e),draft=x.create({name:'Modes',question:'Does attribution matter?',prediction:'It may.',base:{branch:b.id,revision:b.head},speaker:'alpha',conditions:[{key:'T',label:'Transcript',control:true,patch:{assembly:{history:'transcript'}}},{key:'P',label:'Perspective',patch:{assembly:{history:'perspective'}}}]});
  x.run(draft.id,1,draft.version);assert.equal(peak,2);releases.forEach(r=>r());await x.active.get(draft.id)?.done;
  const trials=x.trials(draft.id);assert.equal(trials.length,2);assert(trials.every(t=>t.status==='completed'));
  for(const t of trials){const mode=t.condition==='T'?'transcript':'perspective',a=s.attempts().find(a=>a.turnId===t.turnId);assert.equal(a.assembly.history,mode);assert.equal(e.read(t.branch).revision.state.assembly?.history,mode);}
  const one=e.read(trials[0].branch);e.commit(one.id,one.head,{...one.revision.state,assembly:{history:'perspective'}},'Only one');assert.equal(e.read(b.id).revision.state.assembly,undefined);assert.equal(e.read(b.id).revision.state.messages.length,state.messages.length);
});
test('§1.5a.4.6 Jev payload and stored character criteria are identical across history modes',async()=>{
  const s=store(),state=perspectiveState(s,'cast');state.shadow=true;const bodies:any[]=[];process.env.TYPESAFE_API_KEY='mock';
  const e=new ProductionEngine(s,async(url,o)=>{if(String(url).includes('typesafe')){bodies.push(JSON.parse(String(o?.body)));return new Response(JSON.stringify({answers:{next_speaker:{}}}));}return response('Fine.');});
  for(const history of ['transcript','perspective'] as const){const b=e.create(history,{...state,assembly:{history}});await e.turn(b.id,b.head,'alpha');}
  assert.equal(bodies.length,2);assert.deepEqual(bodies[0],bodies[1]);assert.equal(bodies[0].questions.next_speaker.criteria.Alice.what,state.characters.alpha.prompt);
});
test('§1.5a.4.7 previews and settings make no calls; changes, forks, retcons and restart retain configuration',()=>{
  const s=store(),state=perspectiveState(s,'cast');delete state.assembly;let calls=0;const e=new ProductionEngine(s,async()=>{calls++;throw Error('No calls');}),people=new People(e,new Vault(s));
  let b=e.create('Preview',state);const before=b.head,preview=people.previewAssembled(b.id,'alpha',{assembly:{history:'perspective'},characters:{alpha:{prompt:'Draft prompt.'}}});assert(preview.assembled.startsWith('Draft prompt.'));assert.equal(e.read(b.id).head,before);
  assert.throws(()=>people.previewAssembled(b.id,'alpha',{assembly:{history:'invalid'}}),/configuration/);
  b=people.settings(b.id,{expected:b.head,assembly:{history:'perspective'}});assert(stateChanges(state,b.revision.state).settings.some(c=>c.field==='assembly'));const saved=b.head;
  b=people.settings(b.id,{expected:b.head,system:'Updated.'});assert.equal(b.revision.state.assembly?.history,'perspective');assert.throws(()=>people.settings(b.id,{expected:saved,assembly:{history:'transcript'}}),/changed/);
  const fork=e.fork(b.id,b.head,'Fork');for(const mode of ['keep','regenerate']){const f=e.fork(fork.id,fork.head,mode),r=e.retcon(f.id,f.head,state.messages[0].id,'Edit.',mode,'keep');assert.equal(r.revision.state.assembly?.history,mode==='keep'?'perspective':undefined);}
  const restarted=new ProductionEngine(new Store(s.root));assert.equal(restarted.read(b.id).revision.state.assembly?.history,'perspective');assert.equal(calls,0);assert.equal(s.attempts().length,0);
});
test('§1.5a.4.8 contract assertion, image retry separators, all providers and recorded failures without fallback',async()=>{
  process.env.TOGETHER_API_KEY='mock';
  const s=store(),state=perspectiveState(s,'attachments'),assembled=assemble(s,state,'alpha');
  for(const provider of ['opengateway','together','demo'] as const){let calls=0;process.env.ROOM_DEMO='1';const result=await generate({provider,model:'mock',temperature:.7,personId:'alpha',labelAtDispatch:'Alice',validationRoster:['Alice','Bob'],assemblyVersion:'v2',assembly:{history:'perspective'},messages:assembled.messages},s,async(_u,o)=>{strictHistory(JSON.parse(String(o?.body)).messages);calls++;return response(calls===1?'Bob: wrong.':'Fine.');});assert.equal(result.attempts.length,provider==='demo'?1:2);if(provider!=='demo'){const last=s.get('attempts',result.attempts[1]).body.messages.at(-1).content;assert.deepEqual(last.slice(-2),[{type:'text',text:'\n\n'},{type:'text',text:"The previous attempt used another participant's label. Write a fresh reply only as Alice, from your own perspective."}]);}}
  const base={provider:'together' as const,model:'mock',temperature:.7,personId:'alpha',labelAtDispatch:'Alice',validationRoster:['Alice','Bob'],assemblyVersion:'v2' as const,assembly:{history:'perspective' as const},messages:assembled.messages};
  const before=s.attempts().length;await assert.rejects(generate({...base,messages:[{role:'assistant',content:'Bad'}]},s,async()=>{throw Error('Must not dispatch');}),/Invalid perspective/);assert.equal(s.attempts().length,before);
  let calls=0;await assert.rejects(generate(base,s,async()=>{calls++;return new Response('unsupported',{status:400});}),/HTTP 400/);assert.equal(calls,1);const failed=s.attempts().find(a=>a.outcome.status==='failed');assert.equal(failed.assembly.history,'perspective');assert.equal(failed.outcome.raw,'unsupported');
});
test('§1.5a.4.3 perspective rejects empty own turns and resolves edited legacy evidence by person ID',async()=>{
  const s=store(),state=perspectiveState(s,'own-first');state.messages[0].text='';assert.throws(()=>assemble(s,state,'alpha'),/Invalid perspective/);
  for(const messages of [[],[{role:'user',content:''}],[{role:'user',content:'A'},{role:'user',content:'B'}],[{role:'user',content:'A'},{role:'assistant',content:[{type:'image_url',image_url:{url:'x'}}]},{role:'user',content:'End'}]])assert.throws(()=>assertPerspective(messages as any),/Invalid perspective/);
  s.put('attempts','historical',{id:'historical',personId:'alpha',labelAtDispatch:'Old'});s.put('turns','old-turn',{id:'old-turn',attempts:['historical']});
  state.messages=[{id:'edited',speaker:'Old',text:'Still mine.',source:'edited',turnId:'old-turn'},{id:'unknown',speaker:'Alice',text:'Not mine.',source:'imported'}];
  const m=assemble(s,state,'alpha').messages;assert.equal(m[2].role,'assistant');assert.equal(m[2].content,'Still mine.');assert.equal(m[3].role,'user');assert(String(m[3].content).startsWith('Alice: Not mine.'));
});
test('§1.5a.4.4 Revise keeps image positions, the complete instruction and one separator in saved final user content',async()=>{
  const s=store(),state=perspectiveState(s,'merged-images');let calls=0;
  const e=new ProductionEngine(s,async(_u,o)=>{strictHistory(JSON.parse(String(o?.body)).messages);calls++;return response(calls===2?'Bob: wrong.':'Fine.');});
  let b=e.create('Images',state);b=await e.turn(b.id,b.head,'alpha');const original=s.attempts()[0],x=new Alternatives(e),review=x.open(b.id,b.revision.state.messages.at(-1)!.id).review;
  const r=await x.propose(review.id,'Keep the source.'),candidate=r.candidates[0],attempts=s.attempts().filter(a=>a.purpose==='alternative');assert.equal(candidate.result.status,'completed');assert.equal(attempts.length,2);
  const first=attempts.find(a=>!a.retryOf)!,parts=original.body.messages.at(-1).content;assert.deepEqual(first.body.messages.at(-1).content,[...parts,{type:'text',text:'\n\n'},{type:'text',text:candidate.instruction}]);assert.deepEqual(first.attachments,original.attachments);
});
test('§1.5a.4.7 HTTP request preview is read-only, reflects draft settings, and equals the dispatched messages',async()=>{
  const s=store(),state=perspectiveState(s,'cast');delete state.assembly;let calls=0;const e=new ProductionEngine(s,async(_u,o)=>{calls++;strictHistory(JSON.parse(String(o?.body)).messages);return response('Fine.');}),b=e.create('HTTP preview',state),{base,close}=await listen(e);
  try {
    const url=base+'/api/branches/'+b.id,settings={expected:b.head,assembly:{history:'perspective'},characters:{alpha:{prompt:'Draft.'}}};
    const result=await fetch(url+'/people/alpha/assembled',json(settings)),preview=await result.json() as any;assert.equal(result.status,200);assert.equal(calls,0);assert.equal(e.read(b.id).head,b.head);
    const invalid=await fetch(url+'/people/alpha/assembled',json({assembly:{history:'perspective',extra:1}}));assert.equal(invalid.status,400);assert.equal(calls,0);
    const saved=await (await fetch(url+'/settings',json(settings))).json() as any;await e.turn(b.id,saved.head,'alpha');assert.deepEqual(s.attempts()[0].body.messages,preview.messages);
  } finally {await close();}
});
test('§1.5a review P2: Add-person preview works in a perspective room with custom framing, with no calls',()=>{
  const s=store();let calls=0;const e=new ProductionEngine(s,async()=>{calls++;throw Error('No calls');});
  const state=perspectiveState(s,'own-first');state.frame={...DEFAULT_FRAME,context:''};const b=e.create('custom',state);
  const p=new People(e,new Vault(s)).previewAdd(b.id,{label:'Newcomer',prompt:'Plain.'});
  assert.match(p.assembled,/Plain\./);assert.equal(calls,0);
});

// ---- Stage 1.6 acceptance: locations (coordination/2026-10-07/33, §10 and §11.F) ----
import { emptyRoomState, type State } from '../src/workbench/engine';
import { visibleTo, localLastSpeaker } from '../src/workbench/locations';
import { transcriptExport } from '../src/workbench/transcriptExport';
const PLACES=[{id:'table',name:'the table'},{id:'hall',name:'the hall'},{id:'yard',name:'the yard'}];
const cap=(k:string)=>k[0].toUpperCase()+k.slice(1);
function locState(at:Record<string,string>,o:{history?:'transcript'|'perspective';frame?:any;active?:string[];shadow?:boolean;flow?:'alternate'}={}) {
  const s=emptyRoomState();s.system='Rules.';const ids=Object.keys(at).filter(k=>k!=='human');
  for(const k of ids)s.characters[k]={label:cap(k),prompt:`You are ${cap(k)}.`,memory:'',provider:'opengateway',model:'mock',temperature:.7};
  s.participants=o.active??ids;s.locations={places:clone(PLACES),at:{human:'table',...at}};
  if(o.history)s.assembly={history:o.history};if(o.frame)s.frame=o.frame;if(o.shadow)s.shadow=true;if(o.flow)s.flow=o.flow;return s;
}
// A room with places and a recording transport: replies name their speaker, Jev bodies are kept apart, and a call can be held.
function places(at:Record<string,string>,o:Parameters<typeof locState>[1]={},prepare?:(s:Store)=>State|void) {
  const s=store(),calls:any[]=[],jev:any[]=[],gates:Promise<void>[]=[];let release=()=>{},n=0;process.env.TYPESAFE_API_KEY='mock';
  const w:any={s,calls,jev,script:(who:string,i:number)=>`${who} speaks ${i}.`,hold:(i:number)=>{gates[i]=new Promise<void>(r=>release=r);},release:()=>release()};
  w.e=new ProductionEngine(s,async(url,opts)=>{const body=JSON.parse(String(opts?.body));if(String(url).includes('typesafe')){jev.push(body);return new Response(JSON.stringify({answers:{next_speaker:{}}}));}
    calls.push(body);const i=n++,who=/identity for this request is ([^.]+)\./.exec(JSON.stringify(body.messages))?.[1]??'?';if(gates[i])await gates[i];return response(w.script(who,i+1));});
  const prepared=prepare?.(s);w.people=new People(w.e,new Vault(s));w.runs=new Runs(w.e);w.id=w.e.create('Places',prepared||locState(at,o)).id;
  w.head=()=>w.e.read(w.id).head;w.state=()=>w.e.read(w.id).revision.state;
  w.say=(text:string,att?:string[])=>w.e.message(w.id,w.head(),text,att);
  w.turn=(speaker:string|undefined,place:string)=>w.e.turn(w.id,w.head(),speaker,undefined,undefined,undefined,{place});
  w.move=(movers:string[],to:string|undefined,extra:any={})=>w.e.move(w.id,w.head(),{movers,to,...extra});
  w.last=()=>JSON.stringify(calls.at(-1));
  return w;
}
const scoped=(place:string,present:string[])=>({place,present,display:{place:PLACES.find(p=>p.id===place)!.name,present:present.map(k=>k==='human'?'Dennis':cap(k))}});
function secrets(s:Store){
  s.put('attachments','sdoc',{id:'sdoc',name:'secret-plan.txt',kind:'document',mime:'text/plain',text:'HIDDEN-DOC-TEXT',data:'SElEREVO',size:8,sha256:'x',at:'2026-10-07T00:00:00Z'});
  s.put('attachments','simg',{id:'simg',name:'secret-face.png',kind:'image',mime:'image/png',data:'U0VDUkVULVBJWEVMUw==',size:13,sha256:'x',at:'2026-10-07T00:00:00Z'});
}
const SECRETS=['XYZZY','HIDDEN-DOC-TEXT','secret-plan','secret-face','U0VDUkVULVBJWEVMUw'];
const leaks=(value:unknown)=>SECRETS.filter(x=>JSON.stringify(value).includes(x));

test('§1.6.10.1 without locations, legacy, v2 transcript and v2 perspective bodies stay byte-identical and carry no location evidence',async()=>{
  const golden=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/transcript-requests.json'),'utf8'));
  for(const name of transcriptCases)assert.deepEqual(await captureTranscript(store(),name),golden[name],name);
  const pg=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/perspective-requests.json'),'utf8'));process.env.TYPESAFE_API_KEY='mock';
  for(const name of perspectiveCases){
    const s=store(),state=perspectiveState(s,name);state.shadow=true;
    const e=new ProductionEngine(s,async(u,o)=>{const body=JSON.parse(String(o?.body));if(String(u).includes('typesafe'))return new Response('{}');assert.deepEqual(body.messages,pg[name],name);return response('Fine.');});
    const b=e.create(name,state);await e.turn(b.id,b.head,'alpha');
    assert.equal(s.attempts()[0].visibility,undefined);const sel=s.list('selections')[0];assert.equal(sel.place,undefined);assert.equal(sel.placePolicy,undefined);
    assert.equal(s.list('jev-requests')[0].visibility,undefined);assert(!e.read(b.id).revision.state.messages.some(m=>m.audience));
  }
});
test('§1.6.10.2 hidden text, documents, images and filenames are absent from every payload field, including a custom frame with {transcript} in several fields',async()=>{
  const frame={identity:'You are {speaker}. Log: {transcript}',context:'Context {transcript}',opening:'Open.',turn:'Turn {transcript} for {participants}.'};
  const w=places({gav:'table',ilse:'hall',human:'hall'},{frame,shadow:true});secrets(w.s);
  w.say('XYZZY in the hall.',['sdoc','simg']);
  await w.turn('gav','table');assert.deepEqual(leaks(w.calls[0]),[]);assert.deepEqual(leaks(w.s.attempts()[0]),[]);assert.equal(w.jev.length,1);assert.deepEqual(leaks(w.jev),[]);
  assert.equal(w.s.attempts()[0].visibility.hidden,1);
  // Positive control: Ilse was there and receives all of it.
  await w.turn('ilse','hall');assert.deepEqual(leaks(w.calls[1]),SECRETS);
});
test('§1.6.10.2 perspective: a custom frame fails preflight with no calls; a hidden own image is filtered out first; a visible own image still fails',async()=>{
  const custom=places({gav:'table',marta:'table'},{history:'perspective',frame:{...DEFAULT_FRAME,context:'Custom {transcript}'},shadow:true});
  await assert.rejects(custom.turn('gav','table'),/default framing/);assert.equal(custom.calls.length,0);assert.equal(custom.jev.length,0);assert.equal(custom.s.list('jev-requests').length,0);
  for(const hidden of [true,false]){
    const w=places({},{},s=>{secrets(s);const st=locState({gav:'table',marta:'table'},{history:'perspective',shadow:true});
      st.messages=[{id:'own',speaker:'Gav',speakerRef:{kind:'person',id:'gav'},text:'My picture.',source:'edited',attachments:['simg'],audience:scoped('table',hidden?['marta']:['gav','marta'])}];return st;});
    if(hidden){await w.turn('gav','table');assert.equal(w.calls.length,1);assert.deepEqual(leaks(w.calls[0]),[]);strictHistory(w.calls[0].messages);}
    else{await assert.rejects(w.turn('gav','table'),/own messages/);assert.equal(w.calls.length,0);assert.equal(w.jev.length,0);}
  }
});
test('§1.6.10.3–4 knowledge belongs to people: unequal knowledge in one place, return visits, and Jev from the speaker’s view',async()=>{
  const w=places({gav:'table',odo:'table',marta:'hall'},{shadow:true});
  w.say('X-TABLE-SECRET');w.move(['gav'],'hall');
  await w.turn('gav','hall');assert(w.last().includes('X-TABLE-SECRET'));
  await w.turn('marta','hall');assert(!w.last().includes('X-TABLE-SECRET'));assert(!JSON.stringify(w.jev.at(-1)).includes('X-TABLE-SECRET'));assert(JSON.stringify(w.jev.at(-2)).includes('X-TABLE-SECRET'));
  assert.deepEqual(w.jev.at(-1).state.participants,['Gav','Marta']);assert.deepEqual(Object.keys(w.jev.at(-1).questions.next_speaker.criteria),['Gav','Marta']);
  assert(w.s.list('jev-requests').some((r:any)=>r.visibility?.person==='marta'&&r.visibility.policy==='audience-1'));
  const hall=w.state().messages.filter((m:any)=>m.audience?.place==='hall'&&m.source==='generated').map((m:any)=>m.text);assert.equal(hall.length,2);
  await w.turn('odo','table');let body=w.last();assert(hall.every((t:string)=>!body.includes(t)));assert(body.includes('Gav goes to the hall.'));
  w.move(['gav','marta'],'table');
  await w.turn('gav','table');body=w.last();assert(body.includes('X-TABLE-SECRET')&&hall.every((t:string)=>body.includes(t)));
  await w.turn('marta','table');body=w.last();assert(!body.includes('X-TABLE-SECRET')&&hall.every((t:string)=>body.includes(t)));
  await w.turn('odo','table');body=w.last();assert(body.includes('X-TABLE-SECRET')&&hall.every((t:string)=>!body.includes(t)));assert(body.includes('Gav and Marta go to the table.'));
});
test('§1.6.10.5 empty visible history uses the empty-history path while hidden messages exist',async()=>{
  for(const history of ['transcript','perspective'] as const){
    const w=places({gav:'table',marta:'hall',human:'hall'},{history});w.say('Hidden hello.');
    await w.turn('gav','table');const m=w.calls[0].messages;assert.equal(m.length,2,history);assert(!w.last().includes('Hidden hello'));
    assert(String(m[1].content).startsWith(DEFAULT_FRAME.opening));
    assert.equal(w.s.attempts()[0].visibility.hidden,1);assert.deepEqual(w.s.attempts()[0].visibility.visibleMessageIds,[]);
  }
});
test('§1.6.10.6 the model roster is local, but a reply labelled as someone in another place is still a wrong-speaker reply',async()=>{
  const w=places({gav:'table',marta:'hall'});w.script=(_who:string,i:number)=>i===1?'Marta: I am in the hall.':'Fine.';
  await w.turn('gav','table');const rejected=w.s.attempts().find((a:any)=>a.outcome.status==='rejected');
  assert(rejected);assert(rejected.validationRoster.includes('Marta'));assert(JSON.stringify(w.calls[0]).includes('Current participants: Gav.'));assert(!JSON.stringify(w.calls[0]).includes('Marta'));
  assert.equal(w.state().messages.at(-1).text,'Fine.');
});
test('§1.6.10.7 edits, audience edits, Revise/Apply, delete/restore, branching, retcons and stale or detached generations never broaden visibility implicitly',async()=>{
  const w=places({gav:'table',marta:'hall'});const {close,call}=await serve(w.e);
  try{
    w.say('PRIVATE-LINE');await w.turn('gav','table');
    let s=w.state();const [line,reply]=s.messages;assert.deepEqual(line.audience.present,['gav','human']);assert.deepEqual(reply.audience.present,['gav','human']);
    const marta=()=>visibleTo(w.state(),'marta').map((m:any)=>m.text).join('|');
    // A text-only history edit keeps the audience even though the client leaves it out.
    let r=await call('/branches/'+w.id+'/history',{expected:w.head(),memory:'keep',messages:s.messages.map((m:any,i:number)=>({id:m.id,speaker:m.speaker,text:i?m.text:'PRIVATE-LINE, edited'}))});
    assert.equal(r.status,200);s=w.state();assert.deepEqual(s.messages[0].audience,line.audience);assert.notEqual(s.messages[0].id,line.id);assert.equal(marta(),'');
    // The history editor never changes an existing audience; each new line needs an explicit place or public.
    const rows=s.messages.map((m:any)=>({id:m.id,speaker:m.speaker,text:m.text})),hist=(messages:any[])=>call('/branches/'+w.id+'/history',{expected:w.head(),memory:'keep',messages});
    assert.match((await hist([{...rows[0],audience:null},rows[1]])).value.error,/audience edit/);
    assert.match((await hist([...rows,{speaker:'Dennis',text:'New.'}])).value.error,/place or public/);
    assert.match((await hist([...rows,{speaker:'Dennis',speakerRef:{kind:'human'},text:'New.',audience:{place:'hall'}}])).value.error,/not in the hall/);
    r=await hist([...rows,{speaker:'Narrator',speakerRef:{kind:'narrator'},text:'Rain in the hall.',audience:{place:'hall'}},{speaker:'Narrator',speakerRef:{kind:'narrator'},text:'Thunder everywhere.',audience:null}]);
    assert.equal(r.status,200);s=w.state();assert.deepEqual(s.messages[2].audience.present,['marta']);assert.equal(s.messages[3].audience,undefined);assert.equal(marta(),'Rain in the hall.|Thunder everywhere.');
    // Audience-only edits are explicit operations with a preview; the preview writes nothing.
    const target=s.messages[0];
    r=await call('/branches/'+w.id+'/messages/'+target.id+'/audience/preview',{audience:null});assert.deepEqual(r.value.gained,['Marta']);assert.equal(w.state().messages[0].id,target.id);
    assert.match((await call('/branches/'+w.id+'/messages/'+target.id+'/audience',{expected:w.head(),audience:{place:'table',present:['human','gav']}})).value.error,/already/);
    r=await call('/branches/'+w.id+'/messages/'+target.id+'/audience',{expected:w.head(),audience:{place:'table',present:['human']}});assert.equal(r.status,200);
    s=w.state();assert.deepEqual(s.messages[0].audience.present,['human']);assert.equal(s.messages[0].text,target.text);assert.equal(s.messages[0].editedFrom[0],target.id);assert.deepEqual(s.messages[0].speakerRef,{kind:'human'});
    assert(!visibleTo(s,'gav').some((m:any)=>m.id===s.messages[0].id),'an explicit audience edit may leave out the speaker');
    // Delete/restore and branching preserve the audience exactly; a one-line retcon keeps it too.
    const g=s.messages[1];let b=w.e.deleteMessage(w.id,w.head(),g.id);const deletion=b.head;b=w.e.restoreMessage(w.id,w.head(),deletion);
    assert.deepEqual(b.revision.state.messages.find((m:any)=>m.id===g.id).audience,g.audience);
    const fork=w.e.fork(w.id,w.head(),'Fork');assert.deepEqual(fork.revision.state.messages.map((m:any)=>m.audience??null),w.state().messages.map((m:any)=>m.audience??null));
    b=w.e.retcon(fork.id,fork.head,g.id,'Gav, retconned.','keep','keep');assert.deepEqual(b.revision.state.messages.find((m:any)=>m.text==='Gav, retconned.').audience,g.audience);
    // Revise reuses the saved request and its visibility; Apply keeps the audience.
    const x=new Alternatives(w.e),review=x.open(w.id,g.id).review,original=w.s.get('attempts',review.inputAttempt);assert.equal(original.visibility.person,'gav');
    const cand=(await x.propose(review.id,'Shorter.')).candidates[0];assert.equal(cand.result.status,'completed');
    for(const a of w.s.attempts().filter((a:any)=>a.purpose==='alternative'))assert.deepEqual(a.visibility,original.visibility);
    const judged=x.judge(cand.id,{expected:null,verdict:'accepted',text:'Shorter reply.'});
    b=x.apply(cand.id,{expected:w.head(),judgment:judged.candidates[0].judgment.id});assert.deepEqual(b.revision.state.messages.find((m:any)=>m.text==='Shorter reply.').audience,g.audience);
    // A stale head is rejected; a reply that returns after a move is detached and never re-stamped.
    await assert.rejects(w.e.turn(w.id,deletion,'gav',undefined,undefined,undefined,{place:'table'}),/changed/);
    w.hold(w.calls.length);const pending=w.turn('gav','table');await tick();w.move(['gav'],'hall');w.release();await pending;
    const detached=w.s.list('turns').find((t:any)=>t.status==='detached');assert(detached);assert(!w.state().messages.some((m:any)=>m.turnId===detached.id));
  }finally{await close();}
});
test('§1.6.10.8 a move is one revision: the third place does not hear it; stale, same-place, multi-origin and inactive moves are rejected; retcons around a move; a move detaches an in-flight reply',async()=>{
  const w=places({gav:'table',odo:'table',marta:'hall',ilse:'yard',pia:'table'},{active:['gav','odo','marta','ilse']});
  w.say('Before the move.');const before=w.head(),said=w.state().messages[0];
  let b=w.move(['gav'],'hall');const m=b.revision.state.messages.at(-1);
  assert.equal(b.revision.parent,before);assert.equal(m.source,'movement');assert.deepEqual(m.speakerRef,{kind:'narrator'});assert.equal(m.text,'Gav goes to the hall.');
  assert.deepEqual(m.audience.present,['gav','odo','human','marta']);assert.equal(m.audience.place,'hall');assert.deepEqual(m.movement,{from:'table',to:'hall',movers:['gav'],display:{from:'the table',to:'the hall',movers:['Gav']}});
  assert.equal(b.revision.state.locations.at.gav,'hall');assert.deepEqual(visibleTo(b.revision.state,'ilse'),[]);assert(!visibleTo(b.revision.state,'pia').some((x:any)=>x.id===m.id));
  assert.throws(()=>w.e.move(w.id,before,{movers:['odo'],to:'yard'}),/changed/);
  assert.throws(()=>w.move(['gav'],'hall'),/already in the hall/);
  assert.throws(()=>w.move(['gav','odo'],'yard'),/same place/);
  assert.throws(()=>w.move(['pia'],'hall'),/inactive/);
  assert.throws(()=>w.move([],'hall'),/who moves/);
  assert.throws(()=>w.move(['odo'],undefined,{newPlace:'The Hall'}),/already a place/);
  b=w.move(['odo','human'],undefined,{newPlace:'the cellar',text:'They slip downstairs.'});const cellar=b.revision.state.locations.places.find((p:any)=>p.name==='the cellar').id;
  assert.equal(b.revision.state.messages.at(-1).text,'They slip downstairs.');assert.deepEqual(b.revision.state.messages.at(-1).audience.present,['odo','human']);assert.equal(b.revision.state.locations.at.human,cellar);
  // Keep mode keeps the current placement; regenerate restores the historical one, and places created since remain.
  const keep=w.e.fork(w.id,w.head(),'keep'),kept=w.e.retcon(keep.id,keep.head,said.id,'Before, retconned.','keep','keep');assert.deepEqual(kept.revision.state.locations.at,w.state().locations.at);
  const regen=w.e.fork(w.id,w.head(),'regen'),again=w.e.retcon(regen.id,regen.head,said.id,'Before, again.','regenerate','keep');
  assert.equal(again.revision.state.locations.at.gav,'table');assert.equal(again.revision.state.locations.at.human,'table');assert(again.revision.state.locations.places.some((p:any)=>p.id===cellar));assert.equal(again.revision.state.messages.length,1);
  // A move during generation detaches the in-flight result.
  w.hold(0);const pending=w.turn('marta','hall');await tick();w.move(['marta'],'yard');w.release();await pending;
  assert.equal(w.s.list('turns')[0].status,'detached');assert(!w.state().messages.some((x:any)=>x.source==='generated'));
});
test('§1.6.10.9 a place run picks only local speakers, using the last speaker in that place',async()=>{
  const w=places({},{},()=>{const st=locState({gav:'table',odo:'table',marta:'hall',ilse:'hall'});
    st.messages=[{id:'o',speaker:'Odo',speakerRef:{kind:'person',id:'odo'},text:'Odo at the table.',source:'edited',audience:scoped('table',['gav','odo','human'])},{id:'m',speaker:'Marta',speakerRef:{kind:'person',id:'marta'},text:'Marta in the hall.',source:'edited',audience:scoped('hall',['marta','ilse'])}];return st;});
  const r=w.runs.start(w.id,{expected:w.head(),maxTurns:4,policy:{kind:'random'},place:'table'});assert.equal(r.place,'table');
  for(let i=1;i<=4;i++)assert.equal((await w.runs.advance(r.id,i)).status,'attached');
  const sel=w.s.list('selections').filter((x:any)=>x.run?.id===r.id).sort((a:any,b:any)=>a.run.index-b.run.index);
  assert.deepEqual(sel.map((x:any)=>x.chosen),['gav','odo','gav','odo']);assert(sel.every((x:any)=>x.place==='table'&&x.placePolicy==='place'&&x.eligible.length===1));
  assert.equal(statusOf(w.s.get('runs',r.id)),'completed');
});
test('§1.6.11.F1 two local pairs in a four-character room: back-and-forth works per place and flow is not reset',async()=>{
  const w=places({gav:'table',odo:'table',marta:'hall',ilse:'hall'},{flow:'alternate'});assert.equal(w.state().flow,'alternate');
  for(const [place,pair] of [['table',['gav','odo']],['hall',['marta','ilse']]] as const){
    const r=w.runs.start(w.id,{expected:w.head(),maxTurns:3,policy:{kind:'alternate',speaker:pair[1]},place});
    for(let i=1;i<=3;i++)assert.equal((await w.runs.advance(r.id,i)).status,'attached');
    assert.deepEqual(w.s.list('selections').filter((x:any)=>x.run?.id===r.id).sort((a:any,b:any)=>a.run.index-b.run.index).map((x:any)=>x.chosen),[pair[1],pair[0],pair[1]]);
  }
  w.people.settings(w.id,{expected:w.head(),system:'Still alternate.'});assert.equal(w.state().flow,'alternate');
  assert.throws(()=>w.runs.start(w.id,{expected:w.head(),maxTurns:1,policy:{kind:'alternate'},place:'yard'}),/Nobody/);
  const plain=locState({gav:'table',odo:'table',marta:'hall',ilse:'hall'},{flow:'alternate'});delete plain.locations;assert.equal(new ProductionEngine(store()).create('Plain',plain).revision.state.flow,'random');
});
test('§1.6.11.F2 public lines and a line made public are excluded from the local last speaker',async()=>{
  const w=places({},{},()=>{const st=locState({gav:'table',odo:'table'});
    st.messages=[{id:'g',speaker:'Gav',speakerRef:{kind:'person',id:'gav'},text:'Gav, located.',source:'edited',audience:scoped('table',['gav','odo','human'])},{id:'o',speaker:'Odo',speakerRef:{kind:'person',id:'odo'},text:'Odo, public.',source:'edited'}];return st;});
  assert.equal(localLastSpeaker(w.state(),'table'),'gav');
  w.e.setAudience(w.id,w.head(),'g',null);assert.equal(localLastSpeaker(w.state(),'table'),null);
  await w.turn(undefined,'table');assert.deepEqual(w.s.list('selections')[0].eligible,['gav','odo']);
});
test('§1.6.10.10 + §10.16 + §11.F5 rotation skips ineligible places, includes one character with you, advances only on attached turns, wraps, is interrupted by moves and restarts, and is not inherited',async()=>{
  const w=places({gav:'table',odo:'table',marta:'hall',ilse:'yard',human:'hall'});const {close,call}=await serve(w.e);
  try{
    const sel=(run:string)=>w.s.list('selections').filter((x:any)=>x.run?.id===run).sort((a:any,b:any)=>a.run.index-b.run.index);
    let run=(await call('/branches/'+w.id+'/runs',{expected:w.head(),maxTurns:5,policy:{kind:'random'},place:'rotate'})).value;
    assert.equal(run.place,'rotate');assert.deepEqual(run.rotation,{order:['table','hall'],cursor:0});
    for(const i of [1,2,3])assert.equal((await call('/runs/'+run.id+'/turns',{index:i})).value.status,'attached');
    assert.deepEqual(sel(run.id).map((x:any)=>[x.place,x.placePolicy,x.cursor]),[['table','rotate',0],['hall','rotate',1],['table','rotate',0]]);assert.equal(sel(run.id)[1].chosen,'marta');
    assert.equal(w.s.get('runs',run.id).rotation.cursor,1);
    // A human interjection detaches the in-flight hall turn; the cursor stays and the next turn retries the hall.
    w.hold(w.calls.length);const pending=call('/runs/'+run.id+'/turns',{index:4});await tick(50);
    assert.equal((await call('/branches/'+w.id+'/messages',{expected:w.head(),text:'Wait.'})).status,200);w.release();
    let out=(await pending).value;assert.equal(out.status,'detached');assert.equal(out.run.status,'running');assert.equal(out.run.rotation.cursor,1);
    out=(await call('/runs/'+run.id+'/turns',{index:5})).value;assert.equal(out.status,'attached');assert.equal(sel(run.id).at(-1).place,'hall');assert.equal(out.run.rotation.cursor,0);
    // A move interrupts the run; its final cursor stays as evidence.
    assert.equal((await call('/branches/'+w.id+'/move',{expected:w.head(),movers:['ilse'],to:'hall'})).status,200);
    const ended=(await call('/runs/'+run.id)).value;assert.equal(ended.status,'interrupted');assert.equal(ended.rotation.cursor,0);assert.match(ended.transitions.at(-1).reason,/moved/);
    // Forks don't inherit an active run; a restart interrupts it and never resumes; placement survives.
    run=(await call('/branches/'+w.id+'/runs',{expected:w.head(),maxTurns:2,policy:{kind:'random'},place:'rotate'})).value;assert.deepEqual(run.rotation.order,['table','hall']);
    const fork=w.e.fork(w.id,w.head(),'Fork');assert.equal((await call('/branches/'+fork.id)).value.run,null);assert.equal((await call('/branches/'+w.id)).value.run.id,run.id);
    const s2=new Store(w.s.root),app2=createApp(new ProductionEngine(s2));recoverOnStartup(app2,s2);
    const restarted=s2.get('runs',run.id);assert.equal(statusOf(restarted),'interrupted');assert.deepEqual(restarted.rotation,{order:['table','hall'],cursor:0});
    assert.equal(new ProductionEngine(new Store(w.s.root)).read(w.id).revision.state.locations!.at.ilse,'hall');
  }finally{await close();}
});
test('§1.6.10.11 + §11.F3 contradictory combinations are rejected at every entry point; an explicit one-character place authorizes its character',async()=>{
  const w=places({gav:'table',odo:'table',marta:'hall',human:'hall'});const {close,call}=await serve(w.e);
  try{
    const start=(body:any)=>call('/branches/'+w.id+'/runs',{expected:w.head(),maxTurns:1,...body});
    assert.match((await start({policy:{kind:'fixed',speaker:'marta'},place:'table'})).value.error,/Marta is not in the table/);
    assert.match((await start({policy:{kind:'fixed',speaker:'gav'},place:'rotate'})).value.error,/cannot rotate/);
    assert.match((await start({policy:{kind:'alternate'},place:'rotate'})).value.error,/every place it visits \(the hall does not\)/);
    assert.match((await start({policy:{kind:'random'}})).value.error,/Choose the place/);
    const turn=(body:any)=>call('/branches/'+w.id+'/turn',{expected:w.head(),...body});
    assert.match((await turn({speaker:'marta',place:'table'})).value.error,/Marta is not in the table/);
    assert.match((await turn({speaker:'gav',place:'rotate'})).value.error,/only available in a run/);
    assert.match((await turn({speaker:'gav'})).value.error,/Choose the place/);
    assert.match((await turn({place:'yard'})).value.error,/Nobody/);
    assert.equal(w.calls.length,0);assert.equal(w.s.list('runs').length,0);
    const r=(await turn({place:'hall'})).value;assert.deepEqual(r.revision.state.messages.at(-1).speakerRef,{kind:'person',id:'marta'});
    const plain=w.e.create('Plain',(()=>{const st=locState({gav:'table'});delete st.locations;return st;})());
    assert.match((await call('/branches/'+plain.id+'/turn',{expected:plain.head,place:'table'})).value.error,/no locations/);
    assert.match((await call('/branches/'+plain.id+'/runs',{expected:plain.head,maxTurns:1,place:'table'})).value.error,/no locations/);
  }finally{await close();}
});
test('§1.6.10.12 inactive people are not present or selectable; rejoining and joining late grant no earlier scoped lines',async()=>{
  const w=places({gav:'table',marta:'table'});w.say('BEFORE');
  w.people.participation(w.id,'marta',{expected:w.head(),active:false});w.say('WHILE-AWAY');
  assert.deepEqual(w.state().messages.at(-1).audience.present,['gav','human']);
  await assert.rejects(w.turn('marta','table'),/not participating/);await w.turn(undefined,'table');assert.equal(w.s.list('selections')[0].chosen,'gav');
  assert.throws(()=>w.people.participation(w.id,'marta',{expected:w.head(),active:true}),/Choose where Marta rejoins/);
  let b=w.people.participation(w.id,'marta',{expected:w.head(),active:true,place:'table'});
  assert.deepEqual(visibleTo(b.revision.state,'marta').map((m:any)=>m.text),['BEFORE']);
  assert.throws(()=>w.people.add(w.id,{expected:w.head(),label:'Newt',prompt:'New.',model:'mock'}),/Choose where Newt starts/);
  b=w.people.add(w.id,{expected:w.head(),label:'Newt',prompt:'New.',model:'mock',place:'table'});const newt=person(b.revision.state,'Newt');
  assert.deepEqual(visibleTo(b.revision.state,newt),[]);
  await w.turn(newt,'table');assert(!w.last().includes('BEFORE')&&!w.last().includes('WHILE-AWAY'));
  await w.turn('marta','table');assert(w.last().includes('BEFORE')&&!w.last().includes('WHILE-AWAY'));
});
test('§1.6.10.13 + §11.F8 a split-place template places people and stamps a human opening; a narrator opening is public; place references are validated',()=>{
  const {vault,people}=world(),{persona:p}=persona(vault,['steady']);
  const cast=[{persona:ref(p),label:'Gav',place:'the hall'},{persona:ref(p),label:'Marta'},{persona:ref(p),label:'Odo',place:'the table'}];
  const t=vault.create({type:'room-template',title:'Split',content:{system:'S',flow:'alternate',places:['the table','the hall'],humanPlace:'the hall',opening:{kind:'human',text:'Opening words.'},cast}});
  const s=people.createRoom({name:'Split',template:ref(t)}).revision.state,L=s.locations!,at=(k:string)=>L.places.find(x=>x.id===L.at[k])!.name;
  assert.deepEqual([at(person(s,'Gav')),at(person(s,'Marta')),at(person(s,'Odo')),at('human')],['the hall','the table','the table','the hall']);assert.equal(s.flow,'alternate');
  assert.deepEqual(s.messages[0].audience!.present,[person(s,'Gav'),'human']);assert.deepEqual(s.messages[0].audience!.display,{place:'the hall',present:['Gav','Dennis']});
  const narrated=people.createRoom({template:ref(vault.create({type:'room-template',title:'Narrated',content:{system:'S',flow:'random',places:['the table'],opening:{kind:'narrator',text:'Once.'},cast:[{persona:ref(p),label:'Gav'}]}}))}).revision.state;
  assert.equal(narrated.messages[0].audience,undefined);assert.equal(narrated.locations!.at.human,narrated.locations!.places[0].id);
  assert.equal(people.createRoom({template:ref(vault.create({type:'room-template',title:'Plain',content:{system:'S',flow:'random',cast:[{persona:ref(p),label:'Gav'}]}}))}).revision.state.locations,undefined);
  for(const bad of [{places:[]},{places:['a','A']},{places:['the table'],humanPlace:'the moon'},{humanPlace:'the hall'},{places:['x:y']}])assert.throws(()=>vault.create({type:'room-template',title:'Bad',content:{system:'',flow:'random',cast:[],...bad}}),/place/i);
  assert.throws(()=>vault.create({type:'room-template',title:'Bad',content:{system:'',flow:'random',places:['the table'],cast:[{persona:ref(p),label:'Gav',place:'the moon'}]}}),/Unknown place/);
});
test('§1.6.10.13 + §11.F4 + §11.F8 concurrent conditions with different placements are isolated and recorded; the place resolves after the patch; places cannot be removed or renamed',async()=>{
  const w=places({gav:'table',marta:'hall'});w.say('TABLE-ONLY');const base=w.e.read(w.id),st=base.revision.state;
  const moved={places:clone(PLACES),at:{...st.locations!.at,marta:'table'}};
  const x=new Experiments(w.e),d=x.create({name:'Placement',question:'Does placement matter?',prediction:'Maybe.',base:{branch:w.id,revision:base.head},speaker:'marta',conditions:[{key:'A',label:'Hall',control:true,patch:{}},{key:'B',label:'Table',patch:{locations:moved}}]});
  x.run(d.id,1,d.version);await x.active.get(d.id)?.done;
  const trials=x.trials(d.id);assert(trials.every(t=>t.status==='completed'));
  const A=trials.find(t=>t.condition==='A')!,B=trials.find(t=>t.condition==='B')!;
  assert.equal(A.place,'hall');assert.equal(B.place,'table');assert.deepEqual(A.visibleMessageIds,[]);assert.deepEqual(B.visibleMessageIds,[],'a placement intervention grants no retroactive knowledge');
  for(const t of [A,B]){const a=w.s.attempts().find((a:any)=>a.turnId===t.turnId);assert.equal(a.visibility.place,t.place);assert(!JSON.stringify(a.body).includes('TABLE-ONLY'));assert.equal(w.s.list('selections').find((r:any)=>r.id===t.turnId).place,t.place);}
  assert(JSON.stringify(w.s.attempts().find((a:any)=>a.turnId===B.turnId).body).includes('Current participants: Gav, Marta.'));
  assert.equal(w.e.read(w.id).revision.state.locations!.at.marta,'hall');assert.equal(w.e.read(B.branch).revision.state.messages[0].audience!.present.includes('marta'),false);
  assert.throws(()=>applyPatch(st,{locations:{places:PLACES.filter(p=>p.id!=='table'),at:{...st.locations!.at,gav:'hall',human:'hall'}}}),/keeps every existing place/);
  assert.throws(()=>applyPatch(st,{locations:{places:PLACES.map(p=>p.id==='hall'?{...p,name:'the parlor'}:p),at:st.locations!.at}}),/keeps every existing place/);
  assert.equal(applyPatch(st,{locations:{places:[...PLACES,{id:'roof',name:'the roof'}],at:{...st.locations!.at,gav:'roof'}}}).locations!.at.gav,'roof');
  const plain=locState({gav:'table'});delete plain.locations;assert.throws(()=>applyPatch(plain,{locations:{places:PLACES,at:{gav:'table',human:'table'}}}),/already has locations/);
});
test('§1.6.10.14 "as seen by X at revision R" is the history projection X’s next request uses',async()=>{
  const w=places({gav:'table',marta:'hall'});const {close,call}=await serve(w.e);
  try{
    w.say('At the table.');const early=w.head();w.move(['marta'],'table');w.e.narrate(w.id,w.head(),'Hall rain.','hall');w.say('Hello, Marta.');
    const seen=(await call('/branches/'+w.id+'/seen/marta')).value;assert.equal(seen.placeName,'the table');assert.equal(seen.hidden,2);
    await w.turn('marta','table');const a=w.s.attempts().find((a:any)=>a.personId==='marta');
    assert.deepEqual(a.visibility.visibleMessageIds,seen.visibleMessageIds);assert.equal(a.visibility.place,'table');
    const s=w.e.read(w.id).revision.state,body=JSON.stringify(a.body);for(const m of s.messages.slice(0,-1))assert.equal(body.includes(m.text),seen.visibleMessageIds.includes(m.id),m.text);
    const then=(await call('/branches/'+w.id+'/seen/marta?revision='+early)).value;assert.equal(then.placeName,'the hall');assert.deepEqual(then.visibleMessageIds,[]);
    assert.equal((await call('/branches/'+w.id+'/seen/human')).value.hidden,1);
    assert.equal((await call('/branches/'+w.id+'/seen/marta?revision=nope')).status,400);
  }finally{await close();}
});
test('§1.6.10.15 printable, Markdown and JSON exports mark scoped lines and movement',async()=>{
  const w=places({gav:'table',marta:'hall'});const {base,close}=await listen(w.e);
  try{
    w.say('Hello table.');w.move(['marta'],'table');w.e.narrate(w.id,w.head(),'Everyone hears thunder.',null);
    const html=await (await fetch(base+'/api/branches/'+w.id+'/transcript')).text(),md=await (await fetch(base+'/api/branches/'+w.id+'/transcript.md')).text(),json:any=await (await fetch(base+'/api/branches/'+w.id+'/export')).json();
    for(const text of [html,md,JSON.stringify(json.locationTags)]){assert(text.includes('[the table: Gav, Dennis]'));assert(text.includes('[move: Marta · the hall → the table]'));assert(text.includes('[the table: Marta, Gav, Dennis]'));}
    assert(md.includes('**Narrator**\n\nEveryone hears thunder.'));assert.equal(Object.keys(json.locationTags).length,2);
  }finally{await close();}
});
test('§1.6.10.17 moving, narrating, enabling, renaming, audience edits, previews and views make zero provider calls',async()=>{
  const w=places({gav:'table',marta:'hall'},{shadow:true});const {close,call}=await serve(w.e);
  try{
    const ok=async(url:string,body?:any)=>{const r=await call(url,body);assert.equal(r.status,200,url+' '+JSON.stringify(r.value));return r.value;};const b='/branches/'+w.id;
    await ok(b+'/move/preview',{movers:['gav'],to:'hall'});await ok(b+'/move',{expected:w.head(),movers:['gav'],to:'hall'});
    await ok(b+'/narration',{expected:w.head(),text:'Dusk.',place:'hall'});await ok(b+'/narration',{expected:w.head(),text:'Bells.',place:null});
    const id=w.state().messages[0].id;await ok(b+'/messages/'+id+'/audience/preview',{audience:null});await ok(b+'/messages/'+id+'/audience',{expected:w.head(),audience:null});
    await ok(b+'/locations/places/yard/rename',{expected:w.head(),name:'the garden'});await ok(b+'/seen/gav');await ok(b);await ok(b+'/people/gav/assembled');await ok(b+'/changes');
    const other=w.e.create('Other',(()=>{const st=locState({gav:'table'});delete st.locations;return st;})()),at={gav:'the room',human:'the room'};
    await ok('/branches/'+other.id+'/locations/preview',{places:['the room'],at});await ok('/branches/'+other.id+'/locations',{expected:other.head,places:['the room'],at});
    assert.equal(w.calls.length,0);assert.equal(w.jev.length,0);assert.equal(w.s.attempts().length,0);assert.equal(w.s.list('jev-requests').length,0);
  }finally{await close();}
});
test('§1.6.11.F6 renaming a place, a character and you: old tags and exports keep old names; new stamps use new ones',()=>{
  const w=places({gav:'table',marta:'table'});w.say('Before renames.');const old=w.state().messages[0];
  w.people.renamePlace(w.id,'table',{expected:w.head(),name:'the bench'});w.people.rename(w.id,'gav',{expected:w.head(),label:'Gavin'});w.people.settings(w.id,{expected:w.head(),human:'Deniz'});
  w.say('After renames.');const s=w.state();
  assert.deepEqual(s.messages[0].audience,old.audience);assert.deepEqual(s.messages[1].audience!.display,{place:'the bench',present:['Gavin','Marta','Deniz']});
  const html=transcriptExport('Renames',s);assert(html.includes('[the table: Gav, Marta, Dennis]'));assert(html.includes('[the bench: Gavin, Marta, Deniz]'));
  assert.throws(()=>w.people.renamePlace(w.id,'hall',{expected:w.head(),name:'the bench'}),/already a place named/);
  assert.deepEqual(w.move(['marta'],'hall').revision.state.messages.at(-1).movement.display,{from:'the bench',to:'the hall',movers:['Marta']});
});
test('§1.6.11.F7 a silent human hears local replies, narration and movement; inactive movers are rejected; hidden human speech does not change another roster',async()=>{
  const w=places({gav:'table',marta:'hall',ilse:'hall',pia:'table',human:'hall'},{active:['gav','marta','ilse']});
  w.move(['gav'],'hall');w.e.narrate(w.id,w.head(),'Lamps flicker.','hall');await w.turn('marta','hall');
  const s=w.state();assert.deepEqual(visibleTo(s,'human').map((m:any)=>m.source),['movement','narration','generated']);assert(s.messages.every((m:any)=>m.audience.present.includes('human')));
  assert.throws(()=>w.move(['pia'],'hall'),/inactive/);
  const r=places({ilse:'hall',marta:'table',human:'hall'});r.say('Only Ilse hears this.');r.move(['marta'],'hall');
  await r.turn('marta','hall');assert(r.last().includes('Current participants: Ilse, Marta.'));assert(!r.last().includes('Dennis'));
  await r.turn('ilse','hall');assert(r.last().includes('Current participants: Dennis, Ilse, Marta.'));
});
test('§1.6.11.F8 enabling locations over existing history keeps it public with no movement line; it cannot be turned off; legacy rooms need the switch',()=>{
  const w=places({},{},()=>{const st=locState({gav:'table',marta:'table'});delete st.locations;st.messages=[{id:'old',speaker:'Dennis',speakerRef:{kind:'human'},text:'Earlier, public.',source:'human'}];return st;});
  const at={gav:'the table',marta:'the hall',human:'the hall'};
  assert.throws(()=>w.people.enableLocations(w.id,{expected:w.head(),places:['the table','the hall'],at:{gav:'the table',human:'the hall'}}),/Place everyone/);
  assert.equal(w.people.previewLocations(w.id,{places:['the table','the hall'],at}).switchRequired,false);assert.equal(w.state().locations,undefined);
  const s=w.people.enableLocations(w.id,{expected:w.head(),places:['the table','the hall'],at}).revision.state;
  assert.equal(s.messages.length,1);assert.equal(s.messages[0].audience,undefined);assert.equal(visibleTo(s,'gav').length,1);
  assert.throws(()=>w.e.commit(w.id,w.head(),{...s,locations:undefined},'Off'),/cannot be turned off/);
  assert.throws(()=>w.e.retcon(w.id,w.head(),'old','Earlier, edited.','regenerate','keep'),/predates locations/);
  assert.throws(()=>w.people.enableLocations(w.id,{expected:w.head(),places:['x'],at:{}}),/already has locations/);
  const legacy=new ProductionEngine(store()),lb=legacy.create('Legacy',initialState()),lp=new People(legacy,new Vault(legacy.store));
  const all=Object.fromEntries([...Object.keys(lb.revision.state.characters),'human'].map(k=>[k,'the room']));
  assert.equal(lp.previewLocations(lb.id,{places:['the room'],at:all}).switchRequired,true);
  assert.throws(()=>lp.enableLocations(lb.id,{expected:lb.head,places:['the room'],at:all}),/switches it to v2/);
  assert.equal(lp.enableLocations(lb.id,{expected:lb.head,places:['the room'],at:all,switchAssembly:true}).revision.state.assemblyVersion,'v2');
});
test('§1.6 §9 the changes view shows audience-only edits, movement and placement',()=>{
  const w=places({gav:'table',marta:'hall'});w.say('Line.');const fork=w.state();
  w.move(['marta'],'table');w.e.setAudience(w.id,w.head(),fork.messages[0].id,null);w.people.renamePlace(w.id,'yard',{expected:w.head(),name:'the garden'});
  const c=stateChanges(fork,w.state());assert.equal(c.audience.length,1);assert.equal(c.audience[0].after,null);assert.deepEqual(c.audience[0].before,fork.messages[0].audience!.display);
  assert.deepEqual(c.locations!.moved,[{key:'marta',label:'Marta',from:'the hall',to:'the table'}]);assert.deepEqual(c.locations!.places.renamed,[{from:'the yard',to:'the garden'}]);
  assert.equal(c.conversation.appended.movement,1);assert.deepEqual(c.conversation.edited,[c.audience[0].id]);
});

// ---- Stage 1.6 review fixes (coordination/2026-10-07/38) ----
test('§1.6 review P1: a missing audience or narration place is rejected, never read as public',async()=>{
  const w=places({gav:'table',marta:'hall'});const {close,call}=await serve(w.e);
  try{
    w.say('HIDDEN-FROM-MARTA');const line=w.state().messages[0],b='/branches/'+w.id;
    for(const body of [{expected:w.head()},{expected:w.head(),audience:undefined}]){
      const r=await call(b+'/messages/'+line.id+'/audience',body);assert.equal(r.status,400);assert.match(r.value.error,/Choose who heard this line/);
    }
    const preview=await call(b+'/messages/'+line.id+'/audience/preview',{});assert.equal(preview.status,400);assert.match(preview.value.error,/Choose who heard this line/);
    assert.throws(()=>w.e.setAudience(w.id,w.head(),line.id,undefined),/Choose who heard this line/);
    assert.deepEqual(w.state().messages[0].audience,line.audience);assert(!visibleTo(w.state(),'marta').length);
    const n=await call(b+'/narration',{expected:w.head(),text:'Where does this go?'});assert.equal(n.status,400);assert.match(n.value.error,/place or public/);
    assert.throws(()=>w.e.narrate(w.id,w.head(),'Nowhere.',undefined),/place or public/);assert.equal(w.state().messages.length,1);
    // Explicit null is the only way to say public.
    assert.equal((await call(b+'/narration',{expected:w.head(),text:'Bells.',place:null})).value.revision.state.messages.at(-1).audience,undefined);
    assert.equal((await call(b+'/messages/'+line.id+'/audience/preview',{audience:null})).status,200);
    await w.turn('marta','hall');assert(!w.last().includes('HIDDEN-FROM-MARTA'));
  }finally{await close();}
});
test('§1.6 review P2: request preview lists only visible image occurrences, in order and with repetitions',()=>{
  const w=places({},{},s=>{
    for(const [id,name] of [['hid','HIDDEN-FILENAME.png'],['vis','visible.png']])s.put('attachments',id,{id,name,kind:'image',mime:'image/png',data:'cGl4ZWw=',size:5,sha256:'x',at:'2026-10-07T00:00:00Z'});
    const st=locState({gav:'table',marta:'hall'});
    st.messages=[{id:'h',speaker:'Marta',speakerRef:{kind:'person',id:'marta'},text:'Hidden.',source:'edited',attachments:['hid'],audience:scoped('hall',['marta'])},
      {id:'v1',speaker:'Dennis',speakerRef:{kind:'human'},text:'One.',source:'edited',attachments:['vis'],audience:scoped('table',['gav','human'])},
      {id:'v2',speaker:'Dennis',speakerRef:{kind:'human'},text:'Again.',source:'edited',attachments:['vis'],audience:scoped('table',['gav','human'])}];return st;});
  const p=w.people.previewAssembled(w.id,'gav');
  assert.deepEqual(p.images.map((i:any)=>i.name),['visible.png','visible.png']);assert(!JSON.stringify(p).includes('HIDDEN-FILENAME'));
  assert.equal(p.messages.flatMap((m:any)=>Array.isArray(m.content)?m.content.filter((x:any)=>x.type==='image_url'):[]).length,p.images.length);
  assert.deepEqual(w.people.previewAssembled(w.id,'marta').images.map((i:any)=>i.name),['HIDDEN-FILENAME.png']);
});
test('§1.6 review P2: settings cannot change who is active in a room with places; participation must choose a place',()=>{
  const w=places({gav:'table',marta:'hall'},{active:['gav']});
  assert.throws(()=>w.people.settings(w.id,{expected:w.head(),participants:['gav','marta']}),/participation/);
  assert.throws(()=>w.people.settings(w.id,{expected:w.head(),participants:[]}),/participation/);
  assert.deepEqual(w.state().participants,['gav']);
  assert.equal(w.people.settings(w.id,{expected:w.head(),participants:['gav'],system:'Same cast.'}).revision.state.system,'Same cast.');
  const plain=places({},{},()=>{const st=locState({gav:'table',marta:'hall'},{active:['gav']});delete st.locations;return st;});
  assert.deepEqual(plain.people.settings(plain.id,{expected:plain.head(),participants:['gav','marta']}).revision.state.participants,['gav','marta']);
});
test('§1.6 review P3: the Flow setting is gated on local pairs in rooms with places',()=>{
  const {flowOption}=require('../web/places.js');
  const pairs=locState({gav:'table',odo:'table',marta:'hall',ilse:'hall'}),none=locState({gav:'table',marta:'hall'}),plain=locState({gav:'table',odo:'table',marta:'hall'});delete plain.locations;
  assert.equal(flowOption(pairs).enabled,true);assert.match(flowOption(pairs).label,/place/);
  assert.equal(flowOption(none).enabled,false);
  assert.equal(flowOption(plain).enabled,false);assert.match(flowOption(plain).label,/exactly two active people/);
  plain.participants=['gav','odo'];assert.equal(flowOption(plain).enabled,true);
});

import { NoteFormatError, SIMULATED_REASONING_V1 } from '../src/workbench/generation';
import { shadowJev } from '../src/workbench/jev';
const simulatedInput = {...input,provider:'opengateway' as const,reasoning:'simulated' as const};
test('simulated note is parsed first, separately recorded with provenance, and never consumes the public limit',async()=>{
  const s=store(),note='Elorin: private\n#notetomyfutureself: PRIVATE MEMORY\n'+'n'.repeat(2300),reply='Boris: '+'p'.repeat(2100)+'\n#notetomyfutureself: public memory';
  const raw=JSON.stringify({choices:[{message:{content:` \n<think>${note}</think>\n${reply}`,reasoning_content:'Native evidence'},finish_reason:'stop'}]});
  const result=await generate(simulatedInput,s,async(_u,o)=>{
    const attempt=s.list('attempts')[0];assert.deepEqual(attempt.simulatedReasoning,{version:'v1'});
    assert.deepEqual(attempt.body,JSON.parse(String(o?.body)));assert.deepEqual(attempt.body.thinking,{type:'disabled'});
    return new Response(raw);
  });
  assert.equal(result.text,'p'.repeat(1999)+'…');assert.deepEqual(result.notes,['public memory']);
  const a=s.attempts()[0];assert.equal(a.outcome.generatedNote,note);assert.equal(a.outcome.raw,raw);assert.equal(reasoningOf(a.outcome),'Native evidence');
  assert.deepEqual(a.outcome.transformations,['Moved generated private note out of reply','Removed future-memory notes from displayed reply','Removed assigned speaker label','Truncated to 2000 characters']);
});
test('simulated format rejects every malformed class before transformations and never attaches partial output',async()=>{
  for(const content of ['Boris: missing','prefix<think>note</think>reply','<think>unclosed','<think>outer<think>nested</think>reply','<think>note</think>reply<think>extra</think>','<think>note</think>reply</think>','</think><think>note</think>reply','<think>note</think> \n','']) {
    const s=store(),e=new Engine(s,async()=>new Response(JSON.stringify({choices:[{message:{content}}]}))),state=initialState();state.characters.Boris.reasoning='simulated';const b=e.create('Malformed',state);
    await assert.rejects(e.turn(b.id,b.head,'Boris'),NoteFormatError);
    assert.equal(e.read(b.id).head,b.head);assert.deepEqual(e.read(b.id).revision.state.messages,[]);assert.equal(s.attempts().length,2);
    for(const a of s.attempts()){assert.equal(a.outcome.status,'rejected');assert(a.outcome.validation);assert.deepEqual(a.outcome.transformations,[]);assert.equal(a.outcome.generatedNote,undefined);assert.equal(a.outcome.text,undefined);}
  }
});
test('simulated delimiter variants are rejected wherever they could leak into a reply',async()=>{
  for(const tag of ['<THINK>','<think >','< think>','<\tThInK\n>','</THINK>','</think >','</ think>','< / ThInK >']) {
    for(const content of [`${tag}note</think>Public`, `<think>note${tag}private</think>Public`, `<think>note</think>Public ${tag}private`, `<think>note</think>Public ${tag}private</think>`]) {
      const s=store(),e=new Engine(s,async()=>response(content)),state=initialState();state.characters.Boris.reasoning='simulated';const b=e.create('Variant',state);
      await assert.rejects(e.turn(b.id,b.head,'Boris'),NoteFormatError);
      assert.equal(e.read(b.id).head,b.head);assert.deepEqual(e.read(b.id).revision.state.messages,[]);assert.equal(s.attempts().length,2);
      for(const a of s.attempts()){assert.equal(a.outcome.status,'rejected');assert.equal(a.outcome.generatedNote,undefined);assert.equal(a.outcome.text,undefined);assert.deepEqual(a.outcome.transformations,[]);}
    }
  }
});
test('incomplete delimiter fragments after the note are rejected through generate() and attachment, including an exhausted retry',async()=>{
  const bad=['<think>private</think>Public line. <think','<think>private</think>Public line. <think secret note','<think>private</think>Public line. </think','<think>private</think>Public line. < THINK','<think>private</think>Public line. </ Think more','<think>private</think>Public line. < / think'];
  for(const content of bad) {
    const g=store();await assert.rejects(generate(simulatedInput,g,async()=>response(content)),NoteFormatError);
    assert.equal(g.attempts().length,2);for(const a of g.attempts()){assert.equal(a.outcome.status,'rejected');assert.equal(a.outcome.text,undefined);assert.equal(a.outcome.generatedNote,undefined);}
    let calls=0;const s=store(),e=new Engine(s,async()=>response(++calls===1?content:'<think>fresh</think>Boris: Clean.')),state=initialState();state.characters.Boris.reasoning='simulated';let b=e.create('Fragment',state);
    b=await e.turn(b.id,b.head,'Boris');assert.equal(calls,2);
    assert.deepEqual(b.revision.state.messages.map(m=>m.text),['Clean.'],'the malformed first response never attaches');assert(!JSON.stringify(b.revision.state).includes('Public line'));
    const [first]=s.attempts().filter(a=>!a.retryOf);assert.equal(first.outcome.status,'rejected');assert.equal(first.outcome.text,undefined);
    const x=store(),ex=new Engine(x,async()=>response(content)),st=initialState();st.characters.Boris.reasoning='simulated';const xb=ex.create('Exhausted',st);
    await assert.rejects(ex.turn(xb.id,xb.head,'Boris'),NoteFormatError);
    assert.equal(ex.read(xb.id).head,xb.head);assert.deepEqual(ex.read(xb.id).revision.state.messages,[]);assert.equal(x.attempts().length,2);
  }
});
test('Revise of a simulated reply asks for the note then only the reply; training export skips it with a visible reason',async()=>{
  for(const reasoning of ['simulated','default'] as const){
    const s=store(),bodies:any[]=[];let next=reasoning==='simulated'?'<think>orig note</think>Boris: Original.':'Boris: Original.';
    const e=new Engine(s,async(_u,o)=>{bodies.push(JSON.parse(String(o?.body)));return response(next);}),state=initialState();state.characters.Boris.reasoning=reasoning;
    let b=e.create('Revise '+reasoning,state);b=e.message(b.id,b.head,'Hello');b=await e.turn(b.id,b.head,'Boris');const original=b.revision.state.messages[1];
    const x=new Alternatives(e),review=x.open(b.id,original.id).review;next=reasoning==='simulated'?'<think>revision note</think>Revised.':'Revised.';
    let d=await x.propose(review.id,'Be shorter.');const instruction=String(bodies.at(-1).messages.at(-1).content),c=d.candidates[0];
    assert.equal(c.result.status,'completed');assert.equal(c.result.text,'Revised.');
    if(reasoning==='simulated'){assert.match(instruction,/first write your brief private note between <think> and <\/think>, then after <\/think> write only the replacement reply, within 2000 characters\./);assert(!instruction.includes('output only the replacement reply'));assert.deepEqual(s.get('attempts',c.result.attempts[0]).simulatedReasoning,{version:'v1'});}
    else {assert.match(instruction,/and output only the replacement reply, within 2000 characters\./);assert(!instruction.includes('<think>'));}
    d=x.judge(c.id,{expected:null,verdict:'accepted',text:'Revised.'});x.curate(review.id,{expected:null,candidate:c.id,judgment:d.candidates[0].judgment.id,approved:true,preference:true});
    const [row]=x.dataset(),app=createApp(e),layer=app._router.stack.find((l:any)=>l.route?.path==='/api/dataset/:kind');
    for(const kind of ['sft','preference']){
      const report=x.exportReport(kind);let sent='';const headers:Record<string,string>={};
      await layer.route.stack[0].handle({params:{kind}},{set(k:string,v:string){headers[k]=v;return this;},attachment(){return this;},type(){return this;},send(v:string){sent=v;return this;},status(){return this;},json(){return this;}},(error:any)=>{if(error)throw error;});
      if(reasoning==='simulated'){assert.deepEqual(x.export(kind),[]);assert.equal(report.skipped,1);assert.match(report.reasons[0],/simulated reasoning/);assert.equal(sent,'');assert.equal(headers['X-Room-Export-Skipped'],'1');assert.match(headers['X-Room-Export-Skipped-Reason'],/simulated reasoning/);}
      else {assert.equal(x.export(kind).length,1);assert.equal(report.skipped,0);assert.equal(headers['X-Room-Export-Skipped'],'0');assert(!JSON.stringify(x.export(kind)).includes('<think>'));}
    }
    if(reasoning==='simulated'){assert.match(row.excluded!,/simulated reasoning/);assert(!JSON.stringify(x.export('sft')).includes('orig note'));}else assert.equal(row.excluded,undefined);
  }
});
test('non-string provider content fails once with the same evidence in default and simulated modes',async()=>{
  for(const content of [undefined,null,42,false,{},[],[{type:'text',text:'<think>note</think>Public'}]]) {
    for(const reasoning of ['default','simulated'] as const) {
      const s=store();let calls=0;const raw=JSON.stringify({choices:[{message:{content},finish_reason:'stop'}],usage:{total_tokens:42}});
      const e=new Engine(s,async()=>{calls++;return new Response(raw);}),state=initialState();state.characters.Boris.reasoning=reasoning;delete state.frame;const b=e.create('Content failure',state);
      await assert.rejects(e.turn(b.id,b.head,'Boris'),error=>error instanceof Error && !(error instanceof NoteFormatError) && error.message==='Provider returned no text content');
      assert.equal(calls,1);assert.equal(e.read(b.id).head,b.head);assert.deepEqual(e.read(b.id).revision.state.messages,[]);assert.equal(s.attempts().length,1);
      const a=s.attempts()[0];assert.equal(a.outcome.status,'failed');assert.equal(a.outcome.validation,null);assert.equal(a.outcome.raw,raw);assert.deepEqual(a.outcome.usage,{total_tokens:42});assert.equal(a.outcome.finishReason,'stop');assert.equal(a.outcome.generatedNote,undefined);assert.equal(a.outcome.text,undefined);assert.deepEqual(a.outcome.transformations,[]);
    }
  }
});
test('note format and wrong speaker share one corrective retry in either order',async()=>{
  for(const outputs of [['missing','<think>note</think>Elorin: wrong'],['<think>note</think>Elorin: wrong','missing'],['missing','missing']]) {
    const s=store();let calls=0;
    await assert.rejects(generate(simulatedInput,s,async()=>response(outputs[calls++])),outputs[1]==='missing'?NoteFormatError:WrongSpeakerError);
    assert.equal(calls,2);const attempts=s.attempts();assert.equal(attempts.filter(a=>a.retryOf).length,1);
  }
  for(const assembly of [undefined,{history:'perspective' as const}]) {
    const s=store();let calls=0;
    const result=await generate({...simulatedInput,...(assembly?{assembly,assemblyVersion:'v2' as const,validationRoster:['Boris','Elorin']}:{} )},s,async(_u,o)=>{
      const body=JSON.parse(String(o?.body));if(assembly)strictHistory(body.messages);
      if(++calls===2){assert(JSON.stringify(body).includes('invalid private-note format'));assert(!JSON.stringify(body).includes('LEAKED NOTE'));}
      return response(calls===1?'<think>LEAKED NOTE':'<think>private</think>Boris: Fresh.');
    });assert.equal(result.text,'Fresh.');assert.equal(calls,2);
  }
  const s=store();let calls=0;await assert.rejects(generate({...simulatedInput,policy:'observe'},s,async()=>{calls++;return response('missing');}),NoteFormatError);assert.equal(calls,2);
});
test('simulated instruction follows the frame turn in legacy, custom, empty and perspective assembly; default/off stay unchanged',async()=>{
  const s=store();
  for(const state of [initialState(),{...initialState(),frame:undefined},{...initialState(),frame:{identity:'identity',context:'context',opening:'opening',turn:'TURN'}},perspectiveState(s,'cast')]) {
    const speaker=state.characters.alpha?'alpha':'Boris',before=assemble(s,state,speaker).messages;
    for(const reasoning of ['default','off'] as const){state.characters[speaker].reasoning=reasoning;assert.deepEqual(assemble(s,state,speaker).messages,before);}
    state.characters[speaker].reasoning='simulated';const messages=assemble(s,state,speaker).messages;
    assert.equal(JSON.stringify(messages).split(SIMULATED_REASONING_V1).length-1,1);
    assert.equal(messages.at(-1)!.content,String(before.at(-1)!.content)+(String(before.at(-1)!.content).trim()?'\n\n':'')+SIMULATED_REASONING_V1);
    if(state.assembly?.history==='perspective')strictHistory(messages);
  }
  for(const reasoning of [undefined,'default','off'] as const){const local=store(),text='<think>ordinary literal text</think>Reply';const result=await generate({...simulatedInput,reasoning},local,async()=>response(text));assert.equal(result.text,text);assert.equal(local.attempts()[0].simulatedReasoning,undefined);assert.equal(local.attempts()[0].outcome.generatedNote,undefined);assert.deepEqual(local.attempts()[0].body.thinking,reasoning==='off'?{type:'disabled'}:undefined);}
});
test('simulated setting survives state and experiment patches and Add person; unverified provider is rejected before dispatch',async()=>{
  const s=store(),state=applyPatch(initialState(),{characters:{Boris:{reasoning:'simulated'}}});validateState(state);
  assert.equal(state.characters.Boris.reasoning,'simulated');assert.equal(initialState().characters.Boris.reasoning,undefined);
  assert.deepEqual(stateChanges(initialState(),state).settings.map(c=>[c.field,c.after]),[['reasoning','simulated']]);
  const e=new Engine(s),b=e.create('Simulated',state);assert.equal(e.read(b.id).revision.state.characters.Boris.reasoning,'simulated');
  const people=new People(e,new Vault(s)),empty=e.create('Empty',emptyRoomState()),added=people.add(empty.id,{expected:empty.head,label:'New',reasoning:'simulated'});assert.equal(Object.values(added.revision.state.characters)[0].reasoning,'simulated');
  for(const reasoning of [undefined,'default','off','simulated'] as const){const room=e.create('Add setting',emptyRoomState()),result=people.add(room.id,{expected:room.head,label:'New',...(reasoning===undefined?{}:{reasoning})}),person=Object.values(result.revision.state.characters)[0];assert.equal(person.reasoning,reasoning==='default'?undefined:reasoning);assert.equal(Object.hasOwn(person,'reasoning'),reasoning==='off'||reasoning==='simulated');}
  assert.throws(()=>applyPatch(state,{characters:{Boris:{provider:'together'}}}),/not verified/);
  await assert.rejects(generate({...simulatedInput,provider:'together'},s,async()=>{throw Error('Must not dispatch');}),/not verified/);assert.equal(s.attempts().length,0);
});
test('simulated canceled and detached replies retain evidence but never enter the conversation',async()=>{
  for(const mode of ['cancel','detach','abort'] as const){
    const s=store();let release!:(r:Response)=>void,started!:()=>void;const ready=new Promise<void>(r=>started=r);
    const e=new Engine(s,async(_u,o)=>{started();return new Promise<Response>((resolve,reject)=>{release=resolve;if(mode==='abort')o?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));});});
    const state=initialState();state.characters.Boris.reasoning='simulated';const b=e.create('Pending',state),pending=e.turn(b.id,b.head,'Boris');await ready;
    if(mode==='detach')e.message(b.id,b.head,'Concurrent edit');else e.cancel(b.id);
    if(mode==='abort')await assert.rejects(pending,/Aborted/);else{release(response('<think>PRIVATE CANCELED</think>Public'));await pending;}
    assert(!JSON.stringify(e.read(b.id).revision.state).includes('PRIVATE CANCELED'));assert(!e.read(b.id).revision.state.messages.some(m=>m.source==='generated'));
    assert.equal(s.list('turns')[0].status,mode==='detach'?'detached':'canceled');assert.equal(s.attempts().length,1);
    assert.equal(s.attempts()[0].outcome.status,mode==='abort'?'canceled':'completed');if(mode!=='abort')assert.equal(s.attempts()[0].outcome.generatedNote,'PRIVATE CANCELED');
  }
});
// Invoke the actual export handlers without opening a listener or making network requests.
async function exportWithoutServer(e:ProductionEngine,branch:string,suffix:string){
  const app=createApp(e),layer=app._router.stack.find((l:any)=>l.route?.path===`/api/branches/:id/${suffix}`);let value:any;
  const res:any={type(){return this;},attachment(){return this;},send(v:any){value=v;return this;},json(v:any){value=v;return this;},status(){return this;}};
  await layer.route.stack[0].handle({params:{id:branch}},res,(error:any)=>{if(error)throw error;});return value;
}
test('generated notes stay out of all character and Jev contexts and conversation exports; research export retains provenance',async()=>{
  const s=store(),e=new Engine(s,async()=>response('<think>UNIQUE PRIVATE NOTE</think>Boris: Public line.')),state=initialState();state.characters.Boris.reasoning='simulated';let b=e.create('Private',state);b=await e.turn(b.id,b.head,'Boris');
  for(const speaker of Object.keys(b.revision.state.characters))assert(!JSON.stringify(assemble(s,b.revision.state,speaker).messages).includes('UNIQUE PRIVATE NOTE'));
  const perspective=clone(b.revision.state);perspective.assemblyVersion='v2';perspective.assembly={history:'perspective'};delete perspective.frame;
  for(const speaker of Object.keys(perspective.characters))assert(!JSON.stringify(assemble(s,perspective,speaker).messages).includes('UNIQUE PRIVATE NOTE'));
  await shadowJev(s,b.revision.state,b.id,b.head,'mock-shadow',async(_u,o)=>{assert(!String(o?.body).includes('UNIQUE PRIVATE NOTE'));return new Response(JSON.stringify({answers:{next_speaker:{}}}));});
  assert(!JSON.stringify(s.list('jev-requests')).includes('UNIQUE PRIVATE NOTE'));
  for(const suffix of ['transcript','transcript.md']){const exported=await exportWithoutServer(e,b.id,suffix);assert(exported.includes('Public line.'));assert(!exported.includes('UNIQUE PRIVATE NOTE'));}
  const exported=await exportWithoutServer(e,b.id,'export'),a=exported.attempts[0];assert.equal(a.outcome.generatedNote,'UNIQUE PRIVATE NOTE');assert.deepEqual(a.simulatedReasoning,{version:'v1'});assert.equal(a.revision,b.revision.parent);assert.equal(a.personId,'Boris');assert.equal(a.provider,'opengateway');assert.equal(a.outcome.id,a.id);assert.equal(a.reasoning,null);
});
test('simulated experiment timeout retries retain the existing six-attempt ceiling',async()=>{
  const s=store();let calls=0;const e=new Engine(s,async()=>{if(++calls%2===1)return response('missing');throw new DOMException('Timed out','TimeoutError');}),x=new Experiments(e),d=design(e);d.conditions=[{key:'A',label:'Simulated',control:true,patch:{characters:{Boris:{reasoning:'simulated'}}}}];const exp=x.create(d);
  x.run(exp.id,1,exp.version);await x.active.get(exp.id)?.done;assert.equal(calls,6);assert.equal(s.attempts().length,6);assert.equal(x.detail(exp.id).trials[0].status,'failed');
});
test('simulated Revise preserves parsing and provenance without carrying the previous private note into context',async()=>{
  const s=store();let calls=0;const e=new Engine(s,async(_u,o)=>{const body=JSON.parse(String(o?.body));assert(!JSON.stringify(body).includes('ORIGINAL PRIVATE'));return response(++calls===1?'<think>ORIGINAL PRIVATE</think>First.':'<think>REVISED PRIVATE</think>Replacement.');});
  const state=initialState();state.characters.Boris.reasoning='simulated';let b=e.create('Revise note',state);b=await e.turn(b.id,b.head,'Boris');
  const x=new Alternatives(e),review=x.open(b.id,b.revision.state.messages[0].id).review,d=await x.propose(review.id,'Try again'),candidate=d.candidates[0];
  assert.equal(candidate.result.text,'Replacement.');const attempt=s.attempts().find(a=>a.purpose==='alternative');assert.deepEqual(attempt.simulatedReasoning,{version:'v1'});assert.equal(attempt.outcome.generatedNote,'REVISED PRIVATE');
  const judged=x.judge(candidate.id,{expected:null,verdict:'accepted',text:candidate.result.text}),judgment=judged.candidates[0].judgment;
  const applied=x.apply(candidate.id,{judgment:judgment.id,expected:b.head});assert.equal(applied.revision.state.messages[0].text,'Replacement.');assert(!JSON.stringify(applied.revision.state).includes('PRIVATE'));
});
