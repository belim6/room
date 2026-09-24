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
  assert(x.detail(exp.id).trials[0].reply.includes('Demo'));
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
    assert.equal(diff.fork.revision,input.base.revision);assert(diff.changes.settings.some((s:any)=>s.field==='system'));
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
