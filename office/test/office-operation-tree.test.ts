import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Allowlist, config } from '../collect/privacy';
import { operationTree } from '../collect/operations';
// @ts-ignore untyped browser module
import * as modelModule from '../web/model.mjs';
const { operationTreeRows, operationTreeDisplay, operationTreeNodeEvents }: any = modelModule;
import type { OfficeEvent } from '../collect/types';

const realEvents = '/Users/denizyuksel/dev/room/events.jsonl';
const event = (id: string, operation?: string, gap = false) => ({ id, operation, ...(gap ? { gap: { direction: 'action-without-log' as const } } : {}) } as OfficeEvent);
const node = (id: string, parent: string | null, aliases: string[] = []) => ({ id, title: id, parent, goal: 'fixture goal', status: 'active', owner: 'Deniz', budget: { unit: 'USD', spend: 10, tokens: 100 }, aliases });

test('configured operation tree aliases and rolls up a forest; missing tree preserves legacy mode', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-tree-'));
  try {
    const room = path.join(dir, 'dev/room'), file = path.join(room, 'work/office/operations.json'); fs.mkdirSync(path.dirname(file), { recursive: true });
    const cfg = config({ OFFICE_HOME: dir }); const allow = new Allowlist(cfg);
    assert.equal(operationTree(file, allow, [event('old')]), undefined);
    fs.writeFileSync(file, JSON.stringify({ nodes: [node('goal', null, ['legacy']), node('child', 'goal', ['old-child'])] }));
    const tree = operationTree(file, allow, [event('a', 'legacy'), event('b', 'old-child', true), event('legacy-sub', 'legacy/subtask'), event('c', 'missing'), event('d')])!;
    assert.deepEqual(tree.nodes.map(n => [n.id, n.eventCount, n.unfiledEventCount, n.gapCount]), [
      ['goal', 3, 0, 1], ['child', 1, 0, 1], ['unfiled', 2, 2, 0],
    ]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('real events.jsonl: every record is placed by id/alias or counted under unfiled', () => {
  const records = fs.readFileSync(realEvents, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(records.length, 253);
  assert.equal(records.filter(r => !r.operation).length, 15);
  const ids = [...new Set(records.map(r => r.operation).filter((x): x is string => typeof x === 'string'))];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-tree-real-'));
  try {
    const room = path.join(dir, 'dev/room'), file = path.join(room, 'work/office/operations.json'); fs.mkdirSync(path.dirname(file), { recursive: true });
    // A two-root fixture tree whose aliases cover all historical IDs; source event operation values remain untouched.
    fs.writeFileSync(file, JSON.stringify({ nodes: [node('legacy-goal-a', null, ids.slice(0, 8)), node('legacy-goal-b', null, ids.slice(8))] }));
    const events = records.map((r, i) => event(String(i), r.operation));
    const before = events.map(e => e.operation), tree = operationTree(file, new Allowlist(config({ OFFICE_HOME: dir })), events)!;
    const placed = tree.nodes.filter(n => n.id !== 'unfiled').reduce((sum, n) => sum + n.eventCount, 0);
    const missing = tree.nodes.find(n => n.id === 'unfiled');
    assert.equal(placed + (missing?.eventCount || 0), records.length);
    assert.equal(missing?.eventCount, 15); assert.equal(missing?.unfiledEventCount, 15);
    for (const n of tree.nodes) assert.equal(operationTreeNodeEvents(events, tree, n.id).length, n.eventCount);
    assert.deepEqual(events.map(e => e.operation), before);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('reports duplicate ids, missing parents, and cycles as an error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-tree-invalid-'));
  try {
    const room = path.join(dir, 'dev/room'), file = path.join(room, 'work/office/operations.json'); fs.mkdirSync(path.dirname(file), { recursive: true });
    const allow = new Allowlist(config({ OFFICE_HOME: dir }));
    for (const rows of [
      [node('x', null), node('x', null)], [node('x', 'absent')], [node('x', 'y'), node('y', 'x')],
    ]) {
      fs.writeFileSync(file, JSON.stringify({ nodes: rows }));
      assert.ok(operationTree(file, allow, [])?.error);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a malformed or reserved-id operations file is reported as an error, not thrown', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-tree-bad-'));
  try {
    const file = path.join(dir, 'dev/room/work/office/operations.json'); fs.mkdirSync(path.dirname(file), { recursive: true });
    const allow = new Allowlist(config({ OFFICE_HOME: dir }));
    fs.writeFileSync(file, '{"nodes": [');
    assert.match(operationTree(file, allow, [])?.error || '', /JSON|Unexpected/i);
    fs.writeFileSync(file, JSON.stringify({ nodes: [node('unfiled', null)] }));
    assert.match(operationTree(file, allow, [event('a')])?.error || '', /reserved/);
    fs.writeFileSync(file, JSON.stringify({ nodes: [node('goal', null)] }));
    assert.equal(operationTree(file, allow, [])?.error, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('tree model displays forest rollups and node selection matches legacy descendant and alias filtering', () => {
  const tree:any={nodes:[
    {id:'goal-a',title:'Goal A',parent:null,status:'active',owner:'Deniz',budget:{tokens:1000},eventCount:3,gapCount:1,unfiledEventCount:0,tokenUsage:{input:10,output:2,cacheRead:0,cacheWrite:0,knownEvents:2,totalEvents:3}},
    {id:'child',title:'Child',parent:'goal-a',status:'done',owner:'A',budget:{},aliases:['old-child'],eventCount:1,gapCount:1,unfiledEventCount:0,tokenUsage:{input:5,output:1,knownEvents:1,totalEvents:1}},
    {id:'goal-b',title:'Goal B',parent:null,status:'planned',owner:'B',budget:{},eventCount:0,gapCount:0,unfiledEventCount:0},
    {id:'unfiled',title:'Unfiled',parent:null,status:'unfiled',owner:'',budget:{},eventCount:1,gapCount:0,unfiledEventCount:1}
  ]};
  assert.deepEqual(operationTreeRows(tree).map((n:any)=>[n.id,n.depth]),[['goal-a',0],['child',1],['goal-b',0],['unfiled',0]]);
  assert.equal(operationTreeDisplay(tree.nodes[0]).tokens,'12');
  assert.equal(operationTreeDisplay(tree.nodes[0]).tokensFull,'12');
  assert.equal(operationTreeDisplay(tree.nodes[0]).known,'2/3');
  assert.equal(operationTreeDisplay(tree.nodes[0]).tokenGaps,'1/3');
  assert.equal(operationTreeDisplay({eventCount:6850,gapCount:55,tokenUsage:{input:500000000,output:17000000,knownEvents:1962,totalEvents:6850}}).tokens,'517M');
  assert.equal(operationTreeDisplay(tree.nodes[0]).burn,'12/1000');
  const events:any[]=[{id:'a',operation:'goal-a'},{id:'b',operation:'old-child'},{id:'c',operation:'outside'},{id:'d'}];
  const oldFilter=events.filter(e=>e.operation==='goal-a'||e.operation?.startsWith('goal-a/'));
  assert.deepEqual(operationTreeNodeEvents(events,tree,'goal-a').map((e:any)=>e.id),[...oldFilter.map(e=>e.id),'b']);
  assert.deepEqual(operationTreeNodeEvents(events,tree,'unfiled').map((e:any)=>e.id),['c','d']);
});

test('placement uses the longest slash-boundary alias prefix and unfiled uses the same decision', () => {
  const tree:any={nodes:[
    {id:'short',title:'Short',parent:null,aliases:['legacy']},
    {id:'long',title:'Long',parent:'short',aliases:['legacy/sub']},
    {id:'unfiled',title:'Unfiled',parent:null},
  ]};
  const events:any[]=[{id:'a',operation:'legacy/subtask'},{id:'b',operation:'legacy/sub/child'},{id:'c',operation:'legacy-other'}];
  assert.deepEqual(operationTreeNodeEvents(events,tree,'short').map((e:any)=>e.id),['a','b']);
  assert.deepEqual(operationTreeNodeEvents(events,tree,'long').map((e:any)=>e.id),['b']);
  assert.deepEqual(operationTreeNodeEvents(events,tree,'unfiled').map((e:any)=>e.id),['c']);
});

test('close records require an existing room summary and evidence; typed tokens are ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-close-'));
  try {
    const room = path.join(dir, 'dev/room'), file = path.join(room, 'work/office/operations.json'); fs.mkdirSync(path.dirname(file), { recursive: true });
    const summary = path.join(room, 'roles/operator/op.md'); fs.mkdirSync(path.dirname(summary), { recursive: true }); fs.writeFileSync(summary, 'closed');
    const allow = new Allowlist(config({ OFFICE_HOME: dir }));
    const closed = { ...node('closed', null), status: 'closed' };
    fs.writeFileSync(file, JSON.stringify({ nodes: [{ ...closed, close: { summary: 'roles/operator/missing.md', evidence: ['evt-1'], closedAt: 'today' } }] }));
    assert.match(operationTree(file, allow, [])!.nodes[0].closeProblems!.join(' '), /existing file/);
    fs.writeFileSync(file, JSON.stringify({ nodes: [{ ...closed, close: { summary: 'roles/operator/op.md', evidence: [], closedAt: 'today' } }] }));
    assert.match(operationTree(file, allow, [])!.nodes[0].closeProblems!.join(' '), /evidence/);
    fs.writeFileSync(file, JSON.stringify({ nodes: [{ ...closed, close: { summary: 'roles/operator/op.md', evidence: ['evt-1'], closedAt: 'today' } }] }));
    assert.equal(operationTree(file, allow, [])!.nodes[0].closeProblems, undefined, 'complete close record is accepted');
    fs.writeFileSync(file, JSON.stringify({ nodes: [{ ...closed, close: { summary: 'roles/operator/op.md', evidence: ['evt-1'], closedAt: 'today', tokens: { input: 999 } } }] }));
    const typed = operationTree(file, allow, [])!.nodes[0];
    assert.ok(typed.closeProblems!.some(p => /tokens is ignored/.test(p)));
    assert.equal(typed.close!.tokens, undefined);
    fs.writeFileSync(file, JSON.stringify({ nodes: [node('active', null)] }));
    assert.equal(operationTree(file, allow, [])!.nodes[0].closeProblems, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
