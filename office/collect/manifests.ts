import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Sink } from './types';
import { manifestFileRecords } from './manifest-json';
import type { Allowlist } from './privacy';
import { maskerFor, opFolderOf } from './rooms';

// Driver manifests (**/manifest-<phase>.jsonl) and driver-state.json: intents, turns, stops, sweeps.
export function parseManifest(file: string, sink: Sink, allow: Allowlist) {
  const stat = { kind: 'driver-manifest', path: file, records: 0, events: 0, unparsed: 0 }; sink.sources.push(stat);
  const op = opFolderOf(allow, file), phase = path.basename(file).replace(/^manifest-|\.jsonl$/g, '');
  const rel = op?.id.startsWith('work/') ? path.relative(path.dirname(allow.roots.work), path.dirname(file)) : path.relative(allow.cfg.coordination, path.dirname(file));
  const id = `driver:${rel}/${phase}`; sink.actor({ id, kind: 'driver', label: `driver ${rel} ${phase}`, parent: 'coordinator', parentInferred: true, source: file });
  const me = sink.ref(id); let started = false, last = ''; let held: { ts: string; r: any }[] = [];
  // arm names in trajectory ids are masked unless the operation folder has a valid unmask record (rooms.ts)
  const parsed = manifestFileRecords(file), M = maskerFor(allow, op?.dir || path.dirname(file), op?.id || rel), T = (t: unknown) => M.name(String(t));
  const push = (e: any, i: number, kind = 'manifest') => { stat.events++; sink.push({ actor: me, source: file, provenance: 'captured', tsSource: 'record', detailRef: { kind, file, lines: i >= 0 ? [i] : [] }, hints: [file], ...e }); };
  stat.unparsed += parsed.unparsed;
  parsed.records.forEach(({ r, i }) => {
    if (!r.at || !r.kind || !Number.isFinite(Date.parse(r.at))) { stat.unparsed++; return; } stat.records++; const ts = new Date(r.at).toISOString(); last = ts;
    if (!started) { started = true; push({ ts, verb: 'spawn', actor: sink.ref('coordinator'), target: { kind: 'actor', id }, label: phase, provenance: 'inferred' }, i); }
    switch (r.kind) {
      // masked: rooms are created in arm order (all v0, then v1), so creation time and file order would tell the arms apart.
      // Their branch events share one coarse time (the run's first branch) and are emitted in a key-seeded order (review P3).
      case 'branch': if (M.masked) { held.push({ ts, r }); return; } return push({ ts, verb: 'write', target: { kind: 'branch', id: String(r.branch) }, label: T(r.traj) }, i);
      case 'phase-start': return push({ ts, verb: 'rule', target: { kind: 'actor', id: 'server' }, label: `phase ${r.phase} start (${(r.trajectories || []).length} rooms)` }, i);
      case 'sweep': return push({ ts, verb: 'rule', target: { kind: 'actor', id: 'server' }, label: `sweep ${r.when}`, outcome: r.ok === false ? 'error' : 'ok' }, i);
      // masked: the driver sends each pair's requests in arm order (v0 first, lower line): held, then emitted with one coarse
      // time per pair and turn, no line numbers, in a seeded order (review recheck). Completion times don't follow the arm: kept.
      case 'intent': if (M.masked) { held.push({ ts, r }); return; } return push({ ts, verb: 'dispatch', target: { kind: 'actor', id: 'server' }, label: `${T(r.traj)} t${r.turn} → ${r.pick?.label || '?'}` }, i);
      case 'done': if (M.masked) { held.push({ ts, r }); return; } return push({ ts, verb: 'turn', actor: sink.ref('server'), target: { kind: 'turn', id: String(r.turnId) }, label: `${T(r.traj)} t${r.turn}`, outcome: r.error ? 'error' : 'ok' }, i, 'manifest-turn');
      case 'phase-end': { const bad = Object.keys(r.stoppedPairs || {}).length + (r.qualifyingFailures || []).length;
        return push({ ts, verb: bad ? 'block' : 'rule', target: { kind: 'actor', id: 'coordinator' }, label: `phase ${r.phase} end${bad ? ` (${bad} stops/failures)` : ''}`, outcome: bad ? 'stopped' : 'ok' }, i); }
      default:
        if (/stop|fail|error|abort/i.test(r.kind)) return push({ ts, verb: /error|fail/i.test(r.kind) ? 'error' : 'block', target: { kind: 'actor', id: 'coordinator' }, label: r.kind, outcome: 'error' }, i);
        stat.unparsed++;
    }
  });
  if (held.length) {
    const seed = M.unmask.keySha256 || 'no-key', h = (t: string) => crypto.createHash('sha256').update(seed + '|' + t).digest('hex'), pairOf = (t: unknown) => { const p = String(t).split('·'); return p.length === 3 ? p[0] + '·' + p[2] : String(t); };
    const t0 = held.filter(x => x.r.kind === 'branch').map(x => x.ts).sort()[0], coarse = new Map<string, string>();
    for (const x of held.filter(x => x.r.kind === 'intent')) { const k = pairOf(x.r.traj) + '|' + x.r.turn; if (!coarse.has(k) || x.ts < coarse.get(k)!) coarse.set(k, x.ts); }
    // live: a pair's members can straddle a poll tick. A pair-turn's events are emitted only together: once every member of
    // the pair is present (members from phase-start, branch and turn records), or the pair is stopped, or after a bounded
    // timeout (2 min of later manifest records, or 10 min of wall time). Full collect and live give the same events.
    const members = new Map<string, Set<string>>(), stopped = new Set<string>(); let turnsSeen = false;
    for (const { r } of parsed.records) {
      for (const t of [r?.traj, ...(Array.isArray(r?.trajectories) ? r.trajectories : [])]) if (typeof t === 'string') { const k = pairOf(t); (members.get(k) || members.set(k, new Set()).get(k)!).add(t); }
      if (r?.kind === 'intent' || r?.kind === 'done') turnsSeen = true;
      if (r?.kind === 'phase-end') { for (const k of Object.keys(r.stoppedPairs || {})) stopped.add(k); for (const f of r.qualifyingFailures || []) stopped.add(String(f?.pair || f?.traj || f)); } }
    const groupKey = (x: { r: any }) => x.r.kind === 'branch' ? pairOf(x.r.traj) + '|branch' : pairOf(x.r.traj) + '|' + x.r.turn + '|' + x.r.kind;
    const groups = new Map<string, { ts: string; r: any }[]>(); for (const x of held) (groups.get(groupKey(x)) || groups.set(groupKey(x), []).get(groupKey(x))!).push(x);
    const ready = (g: { ts: string; r: any }[]) => { const pair = pairOf(g[0].r.traj), g0 = g.map(x => x.ts).sort()[0];
      if (stopped.has(pair) || g.some(x => stopped.has(String(x.r.traj)))) return true;
      if (Date.parse(last) - Date.parse(g0) > 120e3 || Date.now() - Date.parse(g0) > 600e3) return true;
      return g[0].r.kind === 'branch' ? turnsSeen : new Set(g.map(x => x.r.traj)).size >= (members.get(pair)?.size || 1); };
    const waiting = [...groups.values()].filter(g => !ready(g)).map(g => Date.parse(g.map(x => x.ts).sort()[0]) + 600e3 + 1);
    if (waiting.length) sink.holdUntil.set(file, Math.min(...waiting));
    held = [...groups.values()].filter(ready).flat();
    const timeOf = (x: { ts: string; r: any }) => x.r.kind === 'branch' ? t0 : x.r.kind === 'intent' ? coarse.get(pairOf(x.r.traj) + '|' + x.r.turn)! : x.ts;
    for (const x of held.sort((a, b) => timeOf(a).localeCompare(timeOf(b)) || h(String(a.r.traj)).localeCompare(h(String(b.r.traj))))) {
      const r = x.r, ts = timeOf(x);
      if (r.kind === 'branch') push({ ts, verb: 'write', target: { kind: 'branch', id: String(r.branch) }, label: T(r.traj), tsSource: 'interpolated' }, -1, 'manifest-masked');
      else if (r.kind === 'intent') push({ ts, verb: 'dispatch', target: { kind: 'actor', id: 'server' }, label: `${T(r.traj)} t${r.turn} → ${r.pick?.label || '?'}`, tsSource: 'interpolated' }, -1, 'manifest-masked');
      else push({ ts, verb: 'turn', actor: sink.ref('server'), target: { kind: 'turn', id: String(r.turnId) }, label: `${T(r.traj)} t${r.turn}`, outcome: r.error ? 'error' : 'ok' }, -1, 'manifest-turn-masked');
    }
  }
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
