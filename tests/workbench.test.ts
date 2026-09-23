import { Comparisons } from '../src/workbench/comparisons';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/workbench/store';
import { Engine } from '../src/workbench/engine';
import { generate } from '../src/workbench/generation';
import { createApp } from '../src/workbench/server';
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
  const retcon=e.retcon(b.id,b.head,message,'Changed event','regenerate','restore');
  assert.equal(retcon.revision.state.characters.Boris.prompt,'Early prompt');assert.equal(retcon.revision.state.messages.length,1);assert.equal(retcon.revision.state.characters.Boris.memory,'Early memory');
  assert.equal(e.read(b.id).revision.state.messages[0].text,'A first event');
  const kept=e.retcon(b.id,b.head,message,'Changed event','keep','keep');const afterRetcon=e.fork(kept.id,kept.head,'Branch edited history',kept.revision.state.messages[0].id);assert.equal(afterRetcon.revision.state.messages.length,1);assert.equal(afterRetcon.revision.state.messages[0].text,'Changed event');assert.equal(kept.revision.state.messages.length,2);assert.equal(kept.revision.state.characters.Boris.memory,'Future memory');
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
  const e=new Engine(s,(url)=>{assert(String(url).includes('typesafe'));return new Promise(r=>{resolveJev=r});});
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
    const history=await post(`/api/branches/${b.id}/history`,{expected:b.head,messages:[{speaker:'Rook',text:'Inserted account'}],memory:'clear'}); assert.equal(history.revision.state.messages.length,1);assert.equal(history.revision.state.messages[0].source,'edited');assert.equal(e.read(b.id).revision.state.messages.length,3);
    const exported=await (await fetch(base+`/api/branches/${b.id}/export`)).json();assert.equal(exported.attempts.length,1);
    assert.equal(exported.selections[0].method,'forced');assert(!JSON.stringify(exported).includes('test-secret'));
  } finally {await new Promise<void>(r=>server.close(()=>r()));}
});


test('saved comparisons persist live pairings and fork both states independently',async()=>{
  const s=store(),e=new Engine(s),comparisons=new Comparisons(e);
  let left=e.create('Left'),right=e.create('Right');
  left=e.message(left.id,left.head,'Left initial');right=e.message(right.id,right.head,'Right initial');
  const saved=comparisons.save({name:'Two viewpoints',left:left.id,right:right.id});
  assert.equal(new Comparisons(new Engine(new Store(s.root))).get(saved.id).right,right.id);
  left=await e.turn(left.id,left.head,'Boris');right=await e.turn(right.id,right.head,'Elorin');
  assert.equal(e.read(comparisons.get(saved.id).left).revision.state.messages.at(-1)?.speaker,'Boris');
  const fork=comparisons.fork(saved.id,'Alternative pair',saved.version);
  assert.equal(fork.parent,saved.id);assert.notEqual(fork.left,saved.left);assert.notEqual(fork.right,saved.right);
  const l=e.read(fork.left),r=e.read(fork.right);
  assert.deepEqual(l.revision.state,left.revision.state);assert.deepEqual(r.revision.state,right.revision.state);
  const changed=l.revision.state;changed.characters.Boris.memory='Only the new left';e.commit(l.id,l.head,changed,'Memory edit');
  await e.turn(r.id,r.head,'Rook');
  assert.equal(e.read(saved.left).revision.state.characters.Boris.memory,'');
  assert.equal(e.read(saved.right).revision.state.messages.length,2);
  assert.equal(e.read(fork.right).revision.state.messages.length,3);
  const updated=comparisons.save({id:saved.id,expected:saved.version,name:'Updated pair',left:fork.left,right:saved.right});
  assert.equal(updated.left,fork.left);assert.throws(()=>comparisons.save({id:saved.id,expected:saved.version,name:'Stale',left:saved.left,right:saved.right}),/changed/);
  assert.throws(()=>comparisons.save({name:'Invalid',left:saved.left,right:saved.left}),/different/);
});

test('comparison routes list, save, reopen and fork a pair without model calls',async()=>{
  const e=new Engine(store()),left=e.create('A'),right=e.create('B');
  const server=createApp(e).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${(server.address() as any).port}/api`;
  const post=async(url:string,body:any)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json()};
  try{
    const saved=await post('/comparisons',{name:'API pair',left:left.id,right:right.id});
    const bootstrap=await (await fetch(base+'/bootstrap')).json();assert.equal(bootstrap.comparisons[0].id,saved.id);
    const opened=await (await fetch(base+'/comparisons/'+saved.id)).json();assert.equal(opened.left,left.id);
    const fork=await post('/comparisons/'+saved.id+'/fork',{name:'Branch pair',expected:saved.version});
    assert.equal(fork.parent,saved.id);assert.equal(e.read(fork.left).parent,left.id);assert.equal(e.read(fork.right).parent,right.id);
    assert.equal(e.store.list('attempts').length,0);
    const entry=await post('/branches/'+left.id+'/trash',{expected:left.head});
    const hidden=await (await fetch(base+'/bootstrap')).json();
    assert.deepEqual(hidden.branches.map((b:any)=>b.id).sort(),[right.id,fork.right].sort());
    assert.equal(hidden.comparisons.length,0);assert.equal(hidden.trash[0].id,entry.id);
    assert.equal((await fetch(base+'/comparisons/'+saved.id)).status,400);
    assert.equal((await fetch(base+'/branches/'+left.id)).status,400);
    await post('/trash/'+entry.id+'/restore',{});
    const restored=await (await fetch(base+'/bootstrap')).json();
    assert.equal(restored.comparisons.length,2);assert.equal(restored.trash.length,0);
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
