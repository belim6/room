import fs from 'node:fs';
import path from 'node:path';
import { Sink, hid, type OfficeEvent, type Artifact, type Actor, type Provenance } from './types';
import { Allowlist, config, type Config } from './privacy';
import { parseClaude, parseSubagents } from './claude';
import { parseCodexLog } from './codex';
import { parseEvents } from './events';
import { parseManifest, parseDriverState } from './manifests';
import { parseSpool, spoolFiles, dedupeKey } from './spool';
import { opTitle, displayName, fileTitle } from './legible';

export interface Coverage { captured: number; derived: number; inferred: number; gaps: number; events: number }
export interface Operation { id: string; label: string; title: string; packet?: string; inferred: boolean; start: string; end: string; coverage: Coverage; actors: number;
  workflow: { template: { source: 'template'; steps: string[] }; run: { source: 'events'; steps: { step: string; first: string; count: number }[] } } }
export interface Collected { cfg: Config; allow: Allowlist; events: OfficeEvent[]; byId: Map<string, OfficeEvent>; actors: Map<string, Actor>; operations: Operation[];
  artifacts: Artifact[]; sources: Sink['sources']; lineIndex: Map<string, number[]>; collectedAt: string; primarySession?: string }

const walk = (root: string, pick: (p: string) => boolean, out: string[] = []) => {
  if (!fs.existsSync(root)) return out;
  for (const n of fs.readdirSync(root).sort()) { const p = path.join(root, n), st = fs.lstatSync(p); if (st.isDirectory() && n !== 'node_modules' && !n.startsWith('.')) walk(p, pick, out); else if (st.isFile() && pick(p)) out.push(p); }
  return out;
};
// Spec §3 workflow template (intended steps). Drawn differently from the observed run path (PSRI rule 1).
export const TEMPLATE = ['plan', 'critic', 'dispatch', 'label', 'lock', 'unmask', 'critic', 'deniz'];

export function collect(cfg: Config = config()): Collected {
  const sink = new Sink(), allow = new Allowlist(cfg);
  // 1-3. Claude transcripts: sessions (the primary one is the coordinator), then their sub-agents.
  const sessions = fs.existsSync(cfg.claudeProject) ? fs.readdirSync(cfg.claudeProject).filter(n => n.endsWith('.jsonl')).sort() : [];
  const primary = cfg.coordinatorSession ? cfg.coordinatorSession.replace(/\.jsonl$/, '') + '.jsonl'
    : sessions.map(n => ({ n, s: fs.statSync(path.join(cfg.claudeProject, n)).size })).sort((a, b) => b.s - a.s)[0]?.n;
  for (const n of sessions) {
    const id = n === primary ? 'coordinator' : 'session:' + n.slice(0, 8);
    if (id !== 'coordinator') sink.actor({ id, kind: 'coordinator', label: 'session ' + n.slice(0, 8), source: path.join(cfg.claudeProject, n) });
    parseClaude({ file: path.join(cfg.claudeProject, n), actorId: id, session: true, primary: n === primary }, sink, allow);
  }
  for (const n of sessions) parseSubagents(path.join(cfg.claudeProject, n.replace(/\.jsonl$/, ''), 'subagents'), sink, allow);
  // 4. Handoff log. 5. Codex logs (derived). 6. Driver manifests.
  parseEvents(path.join(cfg.coordination, 'events.jsonl'), sink, allow);
  const coordFiles = walk(cfg.coordination, () => true);
  for (const f of coordFiles.filter(f => /\/labels\/codex\/[^/]+\.log$/.test(f))) parseCodexLog(f, 'labeler', sink, allow);
  for (const f of coordFiles.filter(f => /\/critic\/[^/]+\.log$/.test(f))) parseCodexLog(f, 'critic', sink, allow);
  for (const f of coordFiles.filter(f => /\/manifest-[^/]+\.jsonl$/.test(f))) parseManifest(f, sink, allow);
  for (const f of coordFiles.filter(f => /\/driver-state\.json$/.test(f))) parseDriverState(f, sink, allow);
  missingLabels(cfg, sink, coordFiles);
  // 7. Live spool (hooks + office-codex): transcript copies of the same tool call win.
  const primarySession = primary?.replace(/\.jsonl$/, ''), known = new Set(sink.events.map(dedupeKey).filter(Boolean));
  for (const f of spoolFiles(allow.roots.spool)) parseSpool(f, sink, allow, { primarySession, known });
  const { events, ops } = finalize(sink, cfg, allow, true);
  const artifacts: Artifact[] = [...coordFiles, ...walk(cfg.promptKnowledge, () => true)].map(p => { const st = fs.statSync(p); return { path: p, group: allow.group(p), size: st.size, mtime: st.mtime.toISOString(), operation: ops.of(p) }; });
  return { cfg, allow, events, byId: new Map(events.map(e => [e.id, e])), actors: sink.actors, operations: operations(events, sink.actors, allow), artifacts, sources: sink.sources, lineIndex: sink.lineIndex, collectedAt: new Date().toISOString(), primarySession };
}

// Shared tail of a full collect and of a live increment: actor refs, operations, (cross-check), order, groups, names.
export function finalize(sink: Sink, cfg: Config, allow: Allowlist, cross: boolean) {
  for (const e of sink.events) e.actor = sink.ref(e.actor.id);
  const ops = inferOperations(cfg, sink, allow);
  if (cross) crossCheck(sink);
  const events = sink.events.sort((a, b) => a.ts.localeCompare(b.ts) || a.seq - b.seq);
  const groups = new Map<string, string>(); // which permanent artifact node a file target sits under (metadata)
  const titles = new Map<string, string>(); // file display names (first heading or the name in words): metadata for chips and edge labels
  for (const e of events) if (e.target?.kind === 'file' && e.target.path) e.target = { ...e.target, group: groups.get(e.target.path) ?? groups.set(e.target.path, allow.group(e.target.path)).get(e.target.path)!, title: fileTitle(e.target.path, allow, titles) } as any;
    else if (e.target && (e.target.kind === 'turn' || e.target.kind === 'branch')) e.target = { ...e.target, group: 'rooms' } as any;
  const byActor = new Map<string, OfficeEvent[]>(); for (const e of events) (byActor.get(e.actor.id) || byActor.set(e.actor.id, []).get(e.actor.id)!).push(e);
  for (const a of sink.actors.values()) if (!a.permanent) a.name = displayName(a, byActor.get(a.id) || events.filter(e => e.target?.id === a.id));
  for (const e of events) e.actor = sink.ref(e.actor.id);
  return { events, ops };
}

// A labeling folder (blind/*.md plus labels/<family>/) where a family has no <id>.json: a failed or missing label.
function missingLabels(cfg: Config, sink: Sink, files: string[]) {
  const set = new Set(files);
  for (const dir of new Set(files.filter(f => /\/blind\/T-[^/]+\.md$/.test(f)).map(f => path.dirname(path.dirname(f))))) {
    const ids = files.filter(f => f.startsWith(dir + '/blind/') && /T-[^/]+\.md$/.test(f)).map(f => path.basename(f, '.md'));
    const fams = fs.existsSync(path.join(dir, 'labels')) ? fs.readdirSync(path.join(dir, 'labels')).filter(n => fs.lstatSync(path.join(dir, 'labels', n)).isDirectory()).sort() : [];
    for (const fam of fams) for (const id of ids) {
      const want = path.join(dir, 'labels', fam, id + '.json'); if (set.has(want)) continue;
      const famFiles = files.filter(f => f.startsWith(path.join(dir, 'labels', fam) + '/'));
      const ts = new Date(Math.max(0, ...famFiles.map(f => fs.statSync(f).mtimeMs))).toISOString();
      sink.push({ ts, actor: sink.ref('coordinator'), verb: 'error', target: { kind: 'file', id: want, path: want }, detailRef: { kind: 'missing-label', file: path.join(dir, 'blind', id + '.md'), lines: [] },
        source: path.join(dir, 'labels', fam), provenance: 'inferred', tsSource: 'mtime', label: `missing ${fam} label ${id}`, outcome: 'missing', hints: [want] });
    }
  }
}

export function inferOperations(cfg: Config, sink: Sink, allow: Allowlist) {
  const coord = allow.roots.coordination, subs = new Map<string, string[]>();
  if (fs.existsSync(coord)) for (const d of fs.readdirSync(coord).filter(n => /^20\d\d-\d\d-\d\d$/.test(n))) subs.set(d, fs.readdirSync(path.join(coord, d)).filter(n => fs.lstatSync(path.join(coord, d, n)).isDirectory()));
  const norm = (s: string) => s.split(coord + '/').join('coordination/').split(cfg.coordination + '/').join('coordination/').replace(/~\/dev\/room\/coordination\//g, 'coordination/');
  // a day-level packet belongs to a sub-operation its file name names, or else its first heading names ("# Date room, step 0")
  const headings = new Map<string, string>();
  const heading = (date: string, file: string) => { const p = path.join(coord, date, file); if (!headings.has(p)) headings.set(p, /^\d\d[a-z]?-[^/]*\.md$/.test(file) ? (allow.read(p, undefined, 4096).content?.match(/^#\s+(.+)$/m)?.[1] || '').toLowerCase() : ''); return headings.get(p)!; };
  const pickSub = (date: string, name: string) => (subs.get(date) || []).filter(s => name.includes(s)).sort((a, b) => b.length - a.length)[0]
    || (subs.get(date) || []).filter(s => new RegExp(`\\b${s.replace(/[^\w]/g, '')}\\b`).test(heading(date, name))).sort((a, b) => b.length - a.length)[0];
  const opsIn = (text: string): string[] => {
    const out: string[] = [], s = norm(text);
    for (const m of s.matchAll(/coordination\/(20\d\d-\d\d-\d\d)(?:\/([^/\s'"`;|&)<>]+))?(\/[^\s'"`;|&)<>]*)?/g)) {
      const [, date, seg = '', rest = ''] = m; if (!subs.has(date)) continue;
      if ((subs.get(date) || []).includes(seg)) {
        const r = rest.match(/^\/(labels|blind)\//) || /labelers?|codexlabel|label-freeze|labels-lock/.test(rest) ? '/labeling' : rest.match(/^\/manifest-([\w-]+)\.jsonl/) ? '/run-' + rest.match(/^\/manifest-([\w-]+)\.jsonl/)![1] : '';
        out.push(`${date}/${seg}${r}`);
      } else { const sub = pickSub(date, seg); out.push(sub ? `${date}/${sub}` : date); }
    }
    for (const m of s.matchAll(/critic\/critic-(20\d\d-\d\d-\d\d)-([\w-]+)/g)) { const sub = pickSub(m[1], m[2]); out.push(sub ? `${m[1]}/${sub}` : m[1]); }
    // cd'd into an operation folder, then relative label paths
    if (out.length && /(^|[\s;'"])(labels|blind)\/|codexlabel/.test(s)) { const base = out.find(o => o.split('/').length === 2); if (base) out.push(base + '/labeling'); }
    return out;
  };
  const deepest = (ops: string[]) => { const c = new Map<string, number>(); for (const o of ops) c.set(o, (c.get(o) || 0) + 1); return [...c].sort((a, b) => b[0].split('/').length - a[0].split('/').length || b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]; };
  // Explicit operations on handoffs win: a spawn/dispatch near a handoff that names the same ref belongs to that operation.
  const pinned = new Map<string, string>();
  for (const h of sink.events.filter(e => e.detailRef.kind === 'handoff' && e.operation && e.detailRef.extra?.ref)) {
    const k = path.basename(String(h.detailRef.extra!.ref)).replace(/\.[a-z]+$/i, '');
    for (const c of sink.coordinatorCalls) if ((c.verb === 'spawn' || c.verb === 'dispatch') && c.target?.kind === 'actor' && Math.abs(Date.parse(c.ts) - Date.parse(h.ts)) < 30 * 60e3 && (c.hints || []).some(x => x.includes(k)))
      { c.operation = h.operation; c.opInferred = true; if (!sink.actors.get(c.target.id)?.permanent) pinned.set(c.target.id, h.operation!); }
  }
  const evOps = new Map<OfficeEvent, string | undefined>();
  for (const e of sink.events) if (!e.operation) evOps.set(e, deepest(opsIn([e.target?.path || '', ...(e.hints || [])].join('\n'))));
  // Ephemeral actors take the deepest operation seen across their own events; their spawn/end follow.
  const byActor = new Map<string, string[]>();
  for (const [e, o] of evOps) if (o && !sink.actors.get(e.actor.id)?.permanent && !e.actor.id.startsWith('session:')) (byActor.get(e.actor.id) || byActor.set(e.actor.id, []).get(e.actor.id)!).push(o);
  for (const [id, os] of byActor) { const a = sink.actors.get(id); if (a) a.operation = deepest(os); }
  for (const [id, op] of pinned) { const a = sink.actors.get(id); if (a) a.operation = op; }
  let prev: OfficeEvent | undefined;
  for (const e of sink.events.slice().sort((a, b) => a.ts.localeCompare(b.ts) || a.seq - b.seq)) {
    if (e.operation) { prev = e; continue; }
    const own = sink.actors.get(e.actor.id), tgt = e.target?.kind === 'actor' ? sink.actors.get(e.target.id) : undefined;
    const op = (!own?.permanent && own?.operation) || (e.verb === 'spawn' && tgt?.operation) || evOps.get(e)
      || (e.actor.id === 'coordinator' || e.actor.id === 'deniz' ? (prev && prev.operation && Date.parse(e.ts) - Date.parse(prev.ts) < 120e3 ? prev.operation : undefined) : undefined);
    if (op) { e.operation = op; e.opInferred = true; }
    if (e.actor.id === 'coordinator' || e.actor.id === 'deniz') prev = e;
  }
  return { of: (p: string) => deepest(opsIn(p)) };
}

// Q3 cross-check: events.jsonl coordinator entries vs session tool calls, both directions; unmatched -> gap events.
function crossCheck(sink: Sink) {
  const W = 30 * 60e3, base = (p = '') => path.basename(p).replace(/\.[a-z]+$/i, '');
  const logs = sink.events.filter(e => e.detailRef.kind === 'handoff' && e.actor.id === 'coordinator');
  // A call that also appended its own log line must not match itself through that line: strip the appended JSON and any
  // shell segment that writes events.jsonl, then match on what is left.
  const strip = (h: string) => h.replace(/\{[^{}\n]*"kind"\s*:[^{}\n]*\}/g, '').split(/\n|;|&&|\|\|/).filter(x => !x.includes('events.jsonl')).join('\n');
  const calls = sink.coordinatorCalls.map(c => ({ ...c, hints: (c.hints || []).map(strip) }) as OfficeEvent), orig = new Map(calls.map((x, i) => [x, sink.coordinatorCalls[i]]));
  const near = (a: OfficeEvent, b: OfficeEvent) => Math.abs(Date.parse(a.ts) - Date.parse(b.ts)) <= W;
  const keyOf = (l: OfficeEvent) => base(String(l.detailRef.extra?.ref || ''));
  const mentions = (c: OfficeEvent, k: string) => k.length >= 4 && (c.hints || []).some(h => h.includes(k));
  const gap = (of: OfficeEvent, direction: 'log-without-action' | 'action-without-log') => sink.push({ ts: of.ts, actor: sink.ref('coordinator'), verb: 'deviation', target: of.target,
    operation: of.operation, opInferred: of.opInferred, detailRef: { kind: 'gap', file: of.detailRef.file, lines: of.detailRef.lines, extra: { of: of.id } }, source: 'cross-check', provenance: 'inferred',
    tsSource: of.tsSource, label: direction === 'log-without-action' ? `logged "${of.label}" but no matching tool call` : 'handoff with no events.jsonl entry', outcome: 'gap', gap: { direction, ref: keyOf(of) || undefined } });
  for (const l of logs) if (!calls.some(c => near(c, l) && mentions(c, keyOf(l)))) gap(l, 'log-without-action');
  if (!logs.length) return;
  const from = logs.reduce((m, l) => l.ts < m ? l.ts : m, logs[0].ts);
  const handoffs = calls.filter(c => c.actor.id === 'coordinator' && c.ts >= from && (c.verb === 'spawn' || (c.verb === 'dispatch' && ['providers', 'server'].includes(c.target?.id || '')) || (c.verb === 'message' && c.target?.id.startsWith('agent:'))));
  for (const c of handoffs) if (!logs.some(l => near(c, l) && (mentions(c, keyOf(l)) || (!!l.operation && l.operation === c.operation)))) gap(orig.get(c)!, 'action-without-log');
}

const STEP = (e: OfficeEvent, actors: Map<string, Actor>): string | undefined => {
  const k = actors.get(e.actor.id)?.kind, p = e.target?.path || '';
  if (e.actor.id === 'deniz' || e.target?.id === 'deniz') return 'deniz';
  if (k === 'critic') return 'critic';
  if (k === 'labeler') return 'label';
  if (e.verb === 'write' && /label-freeze|labels-lock/.test(p)) return 'lock';
  if (e.verb === 'read' && /restricted\/key\.json/.test(p)) return 'unmask';
  if (e.actor.id === 'coordinator' && e.verb === 'write' && /\/\d\d[a-z]?-[^/]*\.md$/.test(p)) return 'plan';
  if (e.actor.id === 'coordinator' && (e.verb === 'spawn' || e.verb === 'dispatch') && e.target?.kind === 'actor') return 'dispatch';
};
export function operations(events: OfficeEvent[], actors: Map<string, Actor>, allow?: Allowlist): Operation[] {
  const ids = new Set<string>(); for (const e of events) if (e.operation) { const parts = e.operation.split('/'); for (let i = 1; i <= parts.length; i++) ids.add(parts.slice(0, i).join('/')); }
  return [...ids].sort().map(id => {
    const evs = events.filter(e => e.operation === id || e.operation?.startsWith(id + '/'));
    const cov: Coverage = { captured: 0, derived: 0, inferred: 0, gaps: 0, events: evs.length };
    for (const e of evs) if (e.gap) cov.gaps++; else cov[e.provenance as Provenance]++;
    const run: { step: string; first: string; count: number }[] = []; let last = '';
    for (const e of evs) { const s = STEP(e, actors); if (!s || s === last) continue; last = s; const r = run.find(x => x.step === s && run[run.length - 1] === x); if (r) r.count++; else run.push({ step: s, first: e.ts, count: 1 }); }
    const t = opTitle(id, allow);
    return { id, label: id.replace(/\//g, ' · '), title: t.title, ...(t.packet ? { packet: t.packet } : {}), inferred: evs.every(e => e.opInferred !== false), start: evs[0]?.ts || '', end: evs[evs.length - 1]?.ts || '', coverage: cov,
      actors: new Set(evs.map(e => e.actor.id)).size, workflow: { template: { source: 'template' as const, steps: TEMPLATE }, run: { source: 'events' as const, steps: run } } };
  }).filter(o => o.coverage.events);
}
export { hid };
