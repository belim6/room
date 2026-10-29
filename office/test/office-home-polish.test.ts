import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser model
import { recentOperations, relativeAgo, nodeAncestors, groupNodeDocuments, documentTitle, documentKind, breadcrumbDisplay, unfiledByDay, operationGraphEdgePath, progressiveOperationGraph } from '../web/model.mjs';

const tree = { nodes: [
  { id: 'alive', parent: null, title: 'Find what makes a room alive' },
  { id: 'spirit', parent: 'alive', title: 'Make the spirit worth having', aliases: ['work/dinner-spirit'] },
  { id: 'baselines', parent: 'alive', title: 'Know what a room does on its own' },
  { id: 'date-room', parent: 'baselines', title: 'Date room' },
  { id: 'instrument', parent: null, title: 'Instrument' },
  { id: 'office', parent: 'instrument', title: 'Office' },
  { id: 'unfiled', parent: null, title: 'Unfiled' },
] };
const now = Date.parse('2026-10-29T12:00:00');
const at = (minAgo: number, operation?: string) => ({ ts: new Date(now - minAgo * 60e3).toISOString(), operation });

test('recent operations: newest first, most specific node, 24 h counts, unfiled left out', () => {
  const events = [at(5, 'work/dinner-spirit/x'), at(30, 'office'), at(60 * 30, 'office'), at(2, 'nowhere'), at(90, 'date-room'), at(12, 'work/dinner-spirit')];
  const rows = recentOperations(events, tree, now);
  assert.deepEqual(rows.map((r: any) => r.id), ['spirit', 'office', 'date-room']);
  assert.equal(rows[0].ago, '5 min ago'); assert.equal(rows[0].last24h, 2); assert.equal(rows[0].parentTitle, 'Find what makes a room alive');
  assert.equal(rows[1].last24h, 1, 'the 30 h old event is outside the last 24 h');
  assert.equal(rows[2].parentTitle, 'Know what a room does on its own');
  assert.equal(recentOperations(events, tree, now, 1).length, 1);
  assert.equal(relativeAgo(3 * 3600e3), '3 h ago'); assert.equal(relativeAgo(3 * 86400e3), '3 d ago'); assert.equal(relativeAgo(10e3), 'just now');
  assert.deepEqual(nodeAncestors(tree, 'date-room'), ['alive', 'baselines']);
});

test('documents group by kind; machine-named records go to Other; never a bare number as a title', () => {
  const d = (path: string, title: string, mtime = '2026-10-20') => ({ path, title, mtime, operation: 'spirit' });
  const items = [d('/r/work/s/gate-check-2-results/outcomes/1.json', '1'), d('/r/work/s/gate-check-2-results/outcomes/10.json', '10'), d('/r/work/s/README.md', 'Spirit'),
    d('/r/critic/critic-2026-10-21-a.md', 'A', '2026-10-21'), d('/r/critic/critic-2026-10-22-b.md', 'B', '2026-10-22'), d('/r/critic/critic-2026-10-22-b.raw.log', 'b raw'),
    d('/r/work/s/stage-1-results.md', 'Stage 1 results'), d('/r/work/s/run-gate.mjs', 'run gate'), d('/r/c/04-packet-for-deniz.md', 'Packet'), d('/r/work/s/labels/t1/items/reply-item-4045.json', 'reply item 4045'), d('/r/work/s/notes.md', 'Notes')];
  const groups = groupNodeDocuments(items);
  assert.deepEqual(groups.map((g: any) => [g.label, g.items.length]), [['Results & summaries', 1], ['Plans & READMEs', 1], ['Critic reviews', 2], ['Packets', 1], ['Scripts', 1], ['Other', 4], ['Raw logs', 1]]);
  assert.deepEqual(groups[2].items.map((x: any) => x.display), ['B', 'A'], 'critic reviews newest first');
  const other = groups.find((g: any) => g.kind === 'other');
  assert.equal(other.collapsed, true); assert.equal(other.items[0].display, 'Notes', 'readable names before machine records');
  assert.deepEqual(other.items.slice(1).map((x: any) => x.display), ['1.json · gate-check-2-results/outcomes', '10.json · gate-check-2-results/outcomes', 'reply-item-4045.json · t1/items']);
  for (const g of groups) for (const x of g.items) assert.ok(/[a-z]/i.test(x.display), x.display);
  assert.equal(documentTitle({ path: '/a/b/7.json', title: '7' }), '7.json · a/b');
  assert.equal(documentKind('/r/work/x-results/outcomes/3.json'), 'other', 'a results folder does not make a record a result');
});

test('breadcrumb ellipsis keeps Home and the last two crumbs, with the full path for the tooltip', () => {
  const c = (t: string, id: string | null = t) => ({ id, title: t });
  const short = [c('Home', null), c('Goal'), c('Node')];
  assert.deepEqual(breadcrumbDisplay(short).crumbs, short);
  const long = [c('Home', null), c('Find what makes a room alive'), c('Make the spirit worth having'), c('Jev decides when the spirit whispers'), c('Gate checks 1, 2 and 4: what does the score track?')];
  const out = breadcrumbDisplay(long);
  assert.deepEqual(out.crumbs.map((x: any) => x.title), ['Home', '…', 'Jev decides when the spirit whispers', 'Gate checks 1, 2 and 4: what does the score track?']);
  assert.deepEqual(out.crumbs[1].hidden, ['Find what makes a room alive', 'Make the spirit worth having']);
  assert.equal(out.full, long.map(x => x.title).join(' › '));
});

test('unfiled events counted by local day: today and yesterday only', () => {
  const day = (d: number, h: number, operation?: string) => ({ ts: new Date(2026, 9, d, h).toISOString(), operation });
  const nowLocal = new Date(2026, 9, 29, 12).getTime();
  const events = [day(29, 1), day(29, 11, 'nowhere'), day(29, 9, 'office'), day(28, 23), day(28, 0), day(28, 5), day(27, 12), day(30, 1)];
  assert.deepEqual(unfiledByDay(events, tree, nowLocal), { today: 2, yesterday: 3 });
});

test('graph edges: each parent->child is its own path from the stub; sibling groups get extra space', () => {
  const g = progressiveOperationGraph(tree, new Set(['alive', 'baselines', 'instrument']));
  const pos = (id: string) => g.nodes.find((n: any) => n.id === id);
  const [spirit, baselines] = [pos('spirit'), pos('baselines')], office = pos('office');
  const paths = g.edges.map((e: any) => operationGraphEdgePath(pos(e.from), pos(e.to), g.cardWidth, g.cardHeight));
  for (const d of paths) assert.doesNotMatch(d, / V/, 'no shared vertical trunk');
  const a = operationGraphEdgePath(pos('alive'), spirit, g.cardWidth, g.cardHeight), b = operationGraphEdgePath(pos('alive'), baselines, g.cardWidth, g.cardHeight);
  assert.equal(a.split(' ')[0], b.split(' ')[0], 'siblings start at the same point on the parent');
  assert.match(b, /^M220,44 H234 C/, 'and leave it after a 14px stub');
  assert.notEqual(a, b);
  assert.ok(b.endsWith(`${baselines.x},${baselines.y + g.cardHeight / 2}`));
  assert.equal(baselines.y - spirit.y, 104, 'siblings in one group keep the row pitch');
  assert.equal(office.y - baselines.y, 104 + 28, 'a new sibling group starts lower');
  const collapsed = progressiveOperationGraph(tree, new Set(['alive']));
  assert.equal(collapsed.nodes.find((n: any) => n.id === 'spirit').y, spirit.y, 'positions stay put when other branches collapse');
});
