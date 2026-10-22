import test from 'node:test';
import assert from 'node:assert/strict';
import { operations } from '../collect/index';
import type { OfficeEvent } from '../collect/types';
// Deniz, 2026-10-22: the dropdown was dated coordination days first, then undated work/research/Office ops appended below.
const ev = (operation: string, ts: string, n: number): OfficeEvent => ({ id: 'e' + n, seq: n, ts, actor: { id: 'engineer' } as any, verb: 'write' as any, operation,
  detailRef: {} as any, source: 'test', derived: false, provenance: 'captured' });
test('operations are a tree ordered by latest activity, newest first at every level', () => {
  const events = [
    ev('2026-10-17/date/labeling', '2026-10-17T09:00:00Z', 1), ev('2026-10-17/date/run-baseline', '2026-10-17T12:00:00Z', 2),
    ev('2026-10-18/office', '2026-10-18T08:00:00Z', 3), ev('work/date-room', '2026-10-20T10:00:00Z', 4),
    ev('research/psri', '2026-10-19T10:00:00Z', 5), ev('work/dinner-spirit', '2026-10-21T15:00:00Z', 6), ev('2026-10-17/date/labeling', '2026-10-17T13:00:00Z', 7),
  ].sort((a, b) => a.ts.localeCompare(b.ts));
  const ops = operations(events, new Map());
  assert.deepEqual(ops.map(o => o.id), ['work', 'work/dinner-spirit', 'work/date-room', 'research', 'research/psri', '2026-10-18', '2026-10-18/office',
    '2026-10-17', '2026-10-17/date', '2026-10-17/date/labeling', '2026-10-17/date/run-baseline']);
  // A parent's last activity covers its children; it's what the dropdown shows as "last <day>".
  const end = new Map(ops.map(o => [o.id, o.end]));
  assert.equal(end.get('work'), '2026-10-21T15:00:00Z'); assert.equal(end.get('2026-10-17/date'), '2026-10-17T13:00:00Z');
  for (const o of ops) { const p = o.id.split('/').slice(0, -1).join('/'); if (p) assert(ops.findIndex(x => x.id === p) < ops.indexOf(o), o.id); }
});
test('ties keep a stable order by id', () => {
  const ops = operations([ev('work/b', '2026-10-20T10:00:00Z', 1), ev('work/a', '2026-10-20T10:00:00Z', 2)], new Map());
  assert.deepEqual(ops.map(o => o.id), ['work', 'work/a', 'work/b']);
});
