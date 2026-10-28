import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser module
import * as model from '../web/model.mjs';
const { parseOfficeRoute, officeRouteHash, operationBreadcrumb, runningStripModel, createRouteGuard, validOfficeOperationRoute } = model as any;

test('hash routes parse home, operation tabs, and legacy operation links', () => {
  assert.deepEqual(parseOfficeRoute('#/'), { page: 'home' });
  assert.deepEqual(parseOfficeRoute('#/op/goal%2Fchild/archive'), { page: 'operation', id: 'goal/child', tab: 'archive' });
  assert.deepEqual(parseOfficeRoute('#op=goal%2Fchild'), { page: 'operation', id: 'goal/child', tab: 'floor', legacy: true });
  assert.equal(officeRouteHash({ page: 'operation', id: 'goal/child', tab: 'workflow' }), '#/op/goal%2Fchild/workflow');
});

test('breadcrumb follows parents from Home to the selected node', () => {
  const tree = { nodes: [{ id: 'goal', title: 'Goal', parent: null }, { id: 'goal/task', title: 'Task', parent: 'goal' }] };
  assert.deepEqual(operationBreadcrumb(tree, 'goal/task'), [{ id: null, title: 'Home' }, { id: 'goal', title: 'Goal' }, { id: 'goal/task', title: 'Task' }]);
});

test('running strip model maps recent unfinished turns to their most specific node', () => {
  const now = Date.now(), tree = { nodes: [{ id: 'goal', title: 'Goal' }, { id: 'goal/task', title: 'Task', budget: { tokens: 500 }, tokenUsage: { events: 1, eventsWithTokens: 1, input: 40 } }] };
  const events = [{ ts: new Date(now - 60_000).toISOString(), operation: 'goal/task/subtask', actor: { id: 'worker' }, verb: 'write' }];
  const rows = runningStripModel(events, [{ id: 'worker', name: 'Worker' }], tree, now);
  assert.equal(rows.length, 1); assert.equal(rows[0].who, 'Worker'); assert.equal(rows[0].nodeId, 'goal/task'); assert.equal(rows[0].nodeTitle, 'Task'); assert.equal(rows[0].ageMs, 60_000);
});

test('route guard rejects every continuation after a newer route starts', () => {
  const guard = createRouteGuard(), first = guard.begin(), second = guard.begin();
  assert.equal(guard.current(first), false); assert.equal(guard.current(second), true);
  const third = guard.begin(); assert.equal(guard.current(second), false); assert.equal(guard.current(third), true);
});

test('unplaced running items are filed under unfiled and retain unknown spend as n/a', () => {
  const now=Date.now(), tree={nodes:[{id:'unfiled',title:'Unfiled',budget:{}}]};
  const rows=runningStripModel([{ts:new Date(now-1000).toISOString(),operation:'unknown/op',actor:{id:'worker'},verb:'write'}],[{id:'worker',name:'Worker'}],tree,now);
  assert.equal(rows[0].nodeId,'unfiled'); assert.equal(rows[0].nodeTitle,'Unfiled'); assert.equal(rows[0].burn,'n/a');
});

test('running item burn is measured against the placed node cap and never defaults to zero', () => {
  const now=Date.now(), tree={nodes:[{id:'goal',title:'Goal',budget:{tokens:100},tokenUsage:{events:1,eventsWithTokens:1,input:35,output:5}}]};
  const event={ts:new Date(now-1000).toISOString(),operation:'goal',actor:{id:'worker'},verb:'write'};
  assert.equal(runningStripModel([event],[{id:'worker',name:'Worker'}],tree,now)[0].burn,'40/100');
  delete (tree.nodes[0] as any).tokenUsage; assert.equal(runningStripModel([event],[{id:'worker',name:'Worker'}],tree,now)[0].burn,'n/a');
});

test('valid operation tree routes accept only tree node ids; fallback accepts legacy ids and star', () => {
  const route=(id:any)=>({page:'operation',id,tab:'floor'}), tree={nodes:[{id:'tree-node'}]}, ops=[{id:'legacy'}];
  assert.equal(validOfficeOperationRoute(route('tree-node'),tree,ops),true);
  assert.equal(validOfficeOperationRoute(route('legacy'),tree,ops),false);
  assert.equal(validOfficeOperationRoute(route('*'),tree,ops),false);
  assert.equal(validOfficeOperationRoute(route('legacy'),{error:'bad tree'},ops),true);
  assert.equal(validOfficeOperationRoute(route('*'),undefined,ops),true);
});
