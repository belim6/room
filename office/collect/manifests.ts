import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Sink } from './types';
import { readLines } from './claude';
import type { Allowlist } from './privacy';
import { maskerFor, opFolderOf } from './rooms';

// Driver manifests (**/manifest-<phase>.jsonl) and driver-state.json: intents, turns, stops, sweeps.
export function parseManifest(file: string, sink: Sink, allow: Allowlist) {
  const stat = { kind: 'driver-manifest', path: file, records: 0, events: 0, unparsed: 0 }; sink.sources.push(stat);
  const op = opFolderOf(allow, file), phase = path.basename(file).replace(/^manifest-|\.jsonl$/g, '');
  const rel = op?.id.startsWith('work/') ? path.relative(path.dirname(allow.roots.work), path.dirname(file)) : path.relative(allow.cfg.coordination, path.dirname(file));
  const id = `driver:${rel}/${phase}`; sink.actor({ id, kind: 'driver', label: `driver ${rel} ${phase}`, parent: 'coordinator', parentInferred: true, source: file });
  const me = sink.ref(id); let started = false, last = ''; const held: { ts: string; r: any }[] = [];
  // arm names in trajectory ids are masked unless the operation folder has a valid unmask record (rooms.ts)
  const lines = readLines(file, sink), M = maskerFor(allow, op?.dir || path.dirname(file), op?.id || rel), T = (t: unknown) => M.name(String(t));
  const push = (e: any, i: number, kind = 'manifest') => { stat.events++; sink.push({ actor: me, source: file, provenance: 'captured', tsSource: 'record', detailRef: { kind, file, lines: i >= 0 ? [i] : [] }, hints: [file], ...e }); };
  lines.forEach((l, i) => {
    if (!l.trim()) return; let r: any; try { r = JSON.parse(l); } catch { stat.unparsed++; return; }
    if (!r.at || !r.kind || !Number.isFinite(Date.parse(r.at))) { stat.unparsed++; return; } stat.records++; const ts = new Date(r.at).toISOString(); last = ts;
    if (!started) { started = true; push({ ts, verb: 'spawn', actor: sink.ref('coordinator'), target: { kind: 'actor', id }, label: phase, provenance: 'inferred' }, i); }
    switch (r.kind) {
      // masked: rooms are created in arm order (all v0, then v1), so creation time and file order would tell the arms apart.
      // Their branch events share one coarse time (the run's first branch) and are emitted in a key-seeded order (review P3).
      case 'branch': if (M.masked) { held.push({ ts, r }); return; } return push({ ts, verb: 'write', target: { kind: 'branch', id: String(r.branch) }, label: T(r.traj) }, i);
      case 'phase-start': return push({ ts, verb: 'rule', target: { kind: 'actor', id: 'server' }, label: `phase ${r.phase} start (${(r.trajectories || []).length} rooms)` }, i);
      case 'sweep': return push({ ts, verb: 'rule', target: { kind: 'actor', id: 'server' }, label: `sweep ${r.when}`, outcome: r.ok === false ? 'error' : 'ok' }, i);
      case 'intent': return push({ ts, verb: 'dispatch', target: { kind: 'actor', id: 'server' }, label: `${T(r.traj)} t${r.turn} → ${r.pick?.label || '?'}` }, i);
      case 'done': return push({ ts, verb: 'turn', actor: sink.ref('server'), target: { kind: 'turn', id: String(r.turnId) }, label: `${T(r.traj)} t${r.turn}`, outcome: r.error ? 'error' : 'ok' }, i, 'manifest-turn');
      case 'phase-end': { const bad = Object.keys(r.stoppedPairs || {}).length + (r.qualifyingFailures || []).length;
        return push({ ts, verb: bad ? 'block' : 'rule', target: { kind: 'actor', id: 'coordinator' }, label: `phase ${r.phase} end${bad ? ` (${bad} stops/failures)` : ''}`, outcome: bad ? 'stopped' : 'ok' }, i); }
      default:
        if (/stop|fail|error|abort/i.test(r.kind)) return push({ ts, verb: /error|fail/i.test(r.kind) ? 'error' : 'block', target: { kind: 'actor', id: 'coordinator' }, label: r.kind, outcome: 'error' }, i);
        stat.unparsed++;
    }
  });
  if (held.length) { const t0 = held.map(h => h.ts).sort()[0], seed = M.unmask.keySha256 || 'no-key', h = (t: string) => crypto.createHash('sha256').update(seed + '|' + t).digest('hex');
    for (const { r } of held.sort((a, b) => h(String(a.r.traj)).localeCompare(h(String(b.r.traj))))) push({ ts: t0, verb: 'write', target: { kind: 'branch', id: String(r.branch) }, label: T(r.traj), tsSource: 'interpolated' }, -1, 'manifest-masked'); }
  if (started) push({ ts: last, verb: 'end', target: { kind: 'actor', id: 'coordinator' }, label: phase, provenance: 'inferred' }, -1);
}
// driver-state.json: only explicit stops become events (the per-turn record duplicates the manifest).
export function parseDriverState(file: string, sink: Sink, allow: Allowlist) {
  const stat = { kind: 'driver-state', path: file, records: 1, events: 0, unparsed: 0 }; sink.sources.push(stat);
  let s: any; try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { stat.unparsed = 1; return; }
  if (s.stopped) {
    const rel = opFolderOf(allow, file)?.id || path.relative(allow.cfg.coordination, path.dirname(file)), at = Number.isFinite(Date.parse(s.stopped.at)) ? s.stopped.at : undefined, ts = new Date(at || fs.statSync(file).mtime).toISOString();
    sink.push({ ts, actor: sink.ref('coordinator'), verb: 'block', target: { kind: 'actor', id: 'server' }, detailRef: { kind: 'driver-state', file, lines: [] }, source: file, provenance: at ? 'captured' : 'inferred',
      tsSource: at ? 'record' : 'mtime', label: `driver stopped (${rel})`, outcome: 'stopped', hints: [file] }); stat.events++;
  }
}
