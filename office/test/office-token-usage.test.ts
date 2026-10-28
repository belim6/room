import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Allowlist, config } from '../collect/privacy';
import { attachTokenUsage } from '../collect/token-usage';
import { operationTree } from '../collect/operations';
import type { OfficeEvent } from '../collect/types';

const claude=(id:string,usage:any)=>JSON.stringify({type:'assistant',timestamp:'2026-10-28T10:00:00.000Z',message:{id,model:'fixture-model',usage,content:[]}});
const event=(id:string,file:string,line:number,operation?:string)=>({id,seq:0,ts:'2026-10-28T10:00:00.000Z',actor:{id:'a',kind:'a',label:'a'},verb:'message',operation,detailRef:{kind:'fixture',file,lines:[line]},source:file,derived:false,provenance:'captured'} as OfficeEvent);
test('dedupes parent/subagent message ids, counts last Codex snapshot once, and leaves gaps unknown through tree rollups',()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'office-token-'));
  try {
    const root=path.join(home,'.claude/projects/project'), sid='12345678-1234-1234-1234-123456789abc', session=path.join(root,`${sid}.jsonl`), subdir=path.join(root,sid,'subagents'); fs.mkdirSync(subdir,{recursive:true});
    const sub=path.join(subdir,'agent-a.jsonl'), codex=path.join(home,'.codex/sessions/2026/10/28/rollout-x.jsonl'); fs.mkdirSync(path.dirname(codex),{recursive:true});
    fs.writeFileSync(session,claude('same',{input_tokens:10,output_tokens:2,cache_read_input_tokens:3})+'\n'+claude('unknown',null)+'\n');
    fs.writeFileSync(sub,claude('same',{input_tokens:10,output_tokens:2,cache_read_input_tokens:3})+'\n'+claude('sub',{iterations:[{input_tokens:4,output_tokens:1},{input_tokens:2,output_tokens:2}],cache_creation_input_tokens:5})+'\n');
    fs.writeFileSync(codex,[{payload:{info:{total_token_usage:{input_tokens:7,cached_input_tokens:3,output_tokens:2}}}},{payload:{info:{total_token_usage:{input_tokens:11,cached_input_tokens:4,output_tokens:5}}}}].map(x=>JSON.stringify(x)).join('\n'));
    fs.mkdirSync(path.join(home,'dev/room/work'),{recursive:true});
    const cfg=config({OFFICE_HOME:home,OFFICE_CLAUDE_PROJECT:root}), allow=new Allowlist(cfg);
    assert.equal(allow.isTranscript(session),true); assert.equal(allow.isTranscript(sub),true);
    const events=[event('parent',session,0,'child'),event('sub',sub,1,'child'),event('missing',session,1,'child')];
    const res=attachTokenUsage(events,allow);
    assert.equal(res.records,3); // two unique Claude ids + one rollout
    assert.equal(events[0].tokenUsage?.input,10); assert.equal(events[1].tokenUsage?.input,6); assert.equal(events[2].tokenUsage,null);
    const attachedTotals=events.map(e=>e.tokenUsage && [e.tokenUsage.input,e.tokenUsage.output,e.tokenUsage.cacheRead,e.tokenUsage.cacheWrite]);
    const again=attachTokenUsage(events,allow);
    assert.deepEqual(events.map(e=>e.tokenUsage && [e.tokenUsage.input,e.tokenUsage.output,e.tokenUsage.cacheRead,e.tokenUsage.cacheWrite]),attachedTotals);
    assert.equal(again.attributedRecords,res.attributedRecords);
    assert.equal(res.unattributed.input,11); assert.equal(res.unattributed.output,5); // Codex final snapshot
    const ops=path.join(home,'dev/room/work/office/operations.json'); fs.mkdirSync(path.dirname(ops),{recursive:true});
    fs.writeFileSync(ops,JSON.stringify({nodes:[{id:'goal',title:'Goal',parent:null,goal:'g',status:'active',owner:'x',budget:{}},{id:'child',title:'Child',parent:'goal',goal:'g',status:'active',owner:'x',budget:{}}]}));
    const tree=operationTree(ops,allow,events,res.unattributed)!;
    assert.equal(tree.error,undefined);
    assert.equal(tree.nodes.find(n=>n.id==='goal')?.tokenUsage?.knownEvents,2);
    assert.equal(tree.nodes.find(n=>n.id==='goal')?.tokenUsage?.totalEvents,3);
    assert.equal(tree.unattributed?.output,5);
    const parents=new Set(tree.nodes.map(n=>n.parent).filter((id):id is string=>!!id));
    const disjointRollups=tree.nodes.filter(n=>n.id==='unfiled'||!parents.has(n.id));
    const nodeInput=disjointRollups.reduce((sum,n)=>sum+(n.tokenUsage?.input||0),0);
    const nodeOutput=disjointRollups.reduce((sum,n)=>sum+(n.tokenUsage?.output||0),0);
    const globalInput=res.unattributed.input+events.reduce((sum,e)=>sum+(e.tokenUsage?.input||0),0);
    const globalOutput=res.unattributed.output+events.reduce((sum,e)=>sum+(e.tokenUsage?.output||0),0);
    assert.ok(nodeInput<=globalInput); assert.ok(nodeOutput<=globalOutput);
  } finally { fs.rmSync(home,{recursive:true,force:true}); }
});
