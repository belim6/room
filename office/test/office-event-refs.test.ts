import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEvents } from '../collect/events';
import { Allowlist, type Config } from '../collect/privacy';
import { Sink } from '../collect/types';

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'office-event-refs-')));
  const room = path.join(root, 'room'), coordination = path.join(room, 'archive/coordination');
  for (const d of [coordination, path.join(room, 'work'), path.join(room, 'critic'), path.join(root, 'home'), path.join(root, 'pk'), path.join(root, 'rd'), path.join(root, 'proj')]) fs.mkdirSync(d, { recursive: true });
  const cfg: Config = { room, coordination, home: path.join(root, 'home'), promptKnowledge: path.join(root, 'pk'), roomData: path.join(root, 'rd'), claudeProject: path.join(root, 'proj'), repos: [room], work: path.join(room, 'work'), research: path.join(room, 'research') };
  const sink = new Sink();
  return { root, room, coordination, cfg, sink, allow: new Allowlist(cfg) };
}
const event = (at: string, ref: string) => JSON.stringify({ at, from: 'claude', to: 'critic', kind: 'packet', ref });

test('events.jsonl refs use the date-specific root and leave missing refs unresolved', () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.room, 'work/dinner-party'), { recursive: true }); fs.writeFileSync(path.join(f.room, 'work/dinner-party/README.md'), 'repo root');
    fs.mkdirSync(path.join(f.coordination, '2026-10-17'), { recursive: true }); fs.writeFileSync(path.join(f.coordination, '2026-10-17/old.md'), 'history root');
    const file = path.join(f.coordination, 'events.jsonl');
    fs.writeFileSync(file, [event('2026-10-19T00:00:00Z', 'work/dinner-party/README.md'), event('2026-10-18T23:59:59Z', '2026-10-17/old.md'), event('2026-10-20T00:00:00Z', 'work/missing.md')].join('\n') + '\n');
    parseEvents(file, f.sink, f.allow);
    const refs = f.sink.events.map(e => e.detailRef.extra?.ref);
    assert.equal(refs[0], path.join(f.room, 'work/dinner-party/README.md'));
    assert.equal(refs[1], path.join(f.coordination, '2026-10-17/old.md'));
    assert.equal(refs[2], path.join(f.room, 'work/missing.md'));
    assert.equal(f.sink.events[0].target?.path, refs[0], 'target path and detail ref share the resolved path');
    assert.equal(f.sink.events[2].detailRef.extra?.ref, refs[2], 'missing refs stay represented without becoming parse errors');
    assert.equal(f.sink.sources[0].unparsed, 0);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('pre-migration event refs fall back to the repo root when history has no matching file', () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.room, 'critic'), { recursive: true }); fs.writeFileSync(path.join(f.room, 'critic/old.md'), 'repo fallback');
    const file = path.join(f.coordination, 'events.jsonl'); fs.writeFileSync(file, event('2026-10-18T00:00:00Z', 'critic/old.md') + '\n');
    parseEvents(file, f.sink, f.allow);
    assert.equal(f.sink.events[0].detailRef.extra?.ref, path.join(f.room, 'critic/old.md'));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
