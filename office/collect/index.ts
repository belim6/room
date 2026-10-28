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
import { blindChecker, refreshBlind } from './rooms';
import { Identity, readRegistry, roleFromTitle, ensureRole, sessionActorId, UUID } from './roles';
import { operationTree, type OperationTree } from './operations';
import { attachTokenUsage } from './token-usage';
import type { TokenUsage } from './types';

export interface Coverage { captured: number; derived: number; inferred: number; gaps: number; events: number }
export interface Operation { id: string; label: string; title: string; packet?: string; inferred: boolean; start: string; end: string; coverage: Coverage; actors: number;
  workflow: { template: { source: 'template'; steps: string[] }; run: { source: 'events'; steps: { step: string; first: string; count: number }[] } } }
export interface Collected { cfg: Config; allow: Allowlist; events: OfficeEvent[]; byId: Map<string, OfficeEvent>; actors: Map<string, Actor>; operations: Operation[];
  operationTree?: OperationTree; tokenUnattributed?: TokenUsage; tokenRecords?: { total: number; attributed: number; unattributed: number }; artifacts: Artifact[]; sources: Sink['sources']; lineIndex: Map<string, number[]>; holdUntil: Map<string, number>; collectedAt: string; primarySession?: string; ident: Identity }

const walk = (root: string, pick: (p: string) => boolean, out: string[] = []) => {
  if (!fs.existsSync(root)) return out;
  for (const n of fs.readdirSync(root).sort()) { const p = path.join(root, n), st = fs.lstatSync(p); if (st.isDirectory() && n !== 'node_modules' && !n.startsWith('.')) walk(p, pick, out); else if (st.isFile() && pick(p)) out.push(p); }
  return out;
};
// Spec §3 workflow template (intended steps). Drawn differently from the observed run path (PSRI rule 1).
export const TEMPLATE = ['plan', 'critic', 'dispatch', 'label', 'lock', 'unmask', 'critic', 'deniz'];

export function collect(cfg: Config = config()): Collected {
  const sink = new Sink(), allow = new Allowlist(cfg); allow.blind = blindChecker(allow); refreshBlind(allow);
  // 0. Who is who: the role registry (roles/sessions.json, written only by office/bin/register-session).
  const reg = readRegistry(cfg.sessions);
  if (cfg.sessions) sink.sources.push({ kind: 'role-registry', path: cfg.sessions, records: reg.entries.length, events: 0, unparsed: reg.skipped, ...(reg.error ? { note: reg.error } : {}) });
  // 1-3. Claude transcripts: sessions in the order they began (a fork's copied history then counts once, in its parent), then
  // their sub-agents. Each record's actor is its session's role at that moment (roles.ts); the pre-O4 primary is the coordinator.
  const sessions = fs.existsSync(cfg.claudeProject) ? fs.readdirSync(cfg.claudeProject).filter(n => n.endsWith('.jsonl')).sort() : [];
  const primary = cfg.coordinatorSession ? cfg.coordinatorSession.replace(/\.jsonl$/, '') + '.jsonl'
    : sessions.map(n => ({ n, s: fs.statSync(path.join(cfg.claudeProject, n)).size })).sort((a, b) => b.s - a.s)[0]?.n;
  const primarySession = primary?.replace(/\.jsonl$/, ''), ident = new Identity(reg.entries, primarySession);
  const began = new Map(sessions.map(n => [n, firstTs(path.join(cfg.claudeProject, n))]));
  for (const n of [...sessions].sort((a, b) => began.get(a)!.localeCompare(began.get(b)!) || a.localeCompare(b))) {
    const sid = n.replace(/\.jsonl$/, '');
    parseClaude({ file: path.join(cfg.claudeProject, n), actorId: n === primary ? 'coordinator' : sessionActorId(sid), session: true, primary: n === primary, ...(UUID.test(sid) ? { sessionId: sid, ident } : {}) }, sink, allow);
  }
  for (const n of sessions) { const sid = n.replace(/\.jsonl$/, ''); parseSubagents(path.join(cfg.claudeProject, sid, 'subagents'), sink, allow, UUID.test(sid) ? (ts: string) => ident.actorAt(sid, ts) : undefined); }
  // 4. Handoff log. 5. Codex logs (derived). 6. Driver manifests. coordination/ (or archive/coordination/), work/, and the
  // top-level homes the reorganisation moves things to (critic/, events.jsonl, briefing/).
  const coordFiles = walk(cfg.coordination, () => true), workFiles = walk(allow.roots.work, () => true), researchFiles = walk(allow.roots.research, () => true);
  const extraFiles = (cfg.extra || []).flatMap(d => walk(d, () => true));
  for (const f of [path.join(cfg.coordination, 'events.jsonl'), ...(cfg.room ? [path.join(cfg.room, 'events.jsonl')] : [])].filter((f, i) => i === 0 || fs.existsSync(f))) parseEvents(f, sink, allow);
  const driverFiles = [...coordFiles, ...workFiles];
  for (const f of driverFiles.filter(f => /\/labels\/codex\/[^/]+\.log$/.test(f))) parseCodexLog(f, 'labeler', sink, allow);
  for (const f of [...coordFiles, ...extraFiles].filter(f => /\/critic\/[^/]+\.log$/.test(f))) parseCodexLog(f, 'critic', sink, allow);
  for (const f of driverFiles.filter(f => /\/manifest-[^/]+\.jsonl$/.test(f))) parseManifest(f, sink, allow);
  for (const f of driverFiles.filter(f => /\/driver-state\.json$/.test(f))) parseDriverState(f, sink, allow);
  missingLabels(cfg, sink, driverFiles);
  // 7. Live spool (hooks + office-codex): transcript copies of the same tool call win.
  const known = new Set(sink.events.map(dedupeKey).filter(Boolean));
  for (const f of spoolFiles(allow.roots.spool)) parseSpool(f, sink, allow, { primarySession, known, ident });
  // 8. Between sessions: messages (send ↔ delivery by msg_id) and the research hand-offs to and from PSRI.
  linkPeers(sink, ident); linkCriticCallers(sink);
  researchEvents(sink, allow, researchFiles);
  ident.apply(sink);
  const { events, ops } = finalize(sink, cfg, allow, true);
  const tokens = attachTokenUsage(events, allow);
  const tree = operationTree(cfg.operations, allow, events, tokens.available ? tokens.unattributed : undefined);
  const artifacts: Artifact[] = [...coordFiles, ...walk(cfg.promptKnowledge, () => true), ...workFiles, ...researchFiles, ...extraFiles].map(p => { const st = fs.statSync(p); return { path: p, group: allow.group(p), size: st.size, mtime: st.mtime.toISOString(), operation: ops.of(p) }; });
  return { cfg, allow, events, byId: new Map(events.map(e => [e.id, e])), actors: sink.actors, operations: operations(events, sink.actors, allow), ...(tree ? { operationTree: tree } : {}), ...(tokens.available ? { tokenUnattributed: tokens.unattributed, tokenRecords: { total: tokens.records, attributed: tokens.attributedRecords, unattributed: tokens.unattributedRecords } } : {}), artifacts, sources: sink.sources, lineIndex: sink.lineIndex, holdUntil: sink.holdUntil, collectedAt: new Date().toISOString(), primarySession, ident };
}
const firstTs = (f: string) => { try { const fd = fs.openSync(f, 'r'), b = Buffer.alloc(65536), n = fs.readSync(fd, b, 0, b.length, 0); fs.closeSync(fd); return (b.toString('utf8', 0, n).match(/"timestamp":\s*"([^"]+)"/) || [])[1] || '9999'; } catch { return '9999'; } };

// Messages between Claude sessions. A send (SendMessage to a name or a session socket) and its delivery (a peer-origin record
// in the receiver's transcript) share a msg_id: linked, the edge is captured on both ends. A send with no delivery found is
// resolved by the recipient's name (a role, or a Desktop title one session carried) or socket (learned from linked pairs or
// the registry): derived. A delivery with no send found (the sender's transcript lives elsewhere) becomes the event: derived.
export function linkPeers(sink: Sink, ident: Identity) {
  const byMsg = new Map(sink.peerDeliveries.filter(d => d.msgId).map(d => [d.msgId, d])), used = new Set<object>();
  for (const s of sink.peerSends) { const d = byMsg.get(String(s.detailRef.extra?.msgId || '')), sess = s.detailRef.extra?.session as string | undefined; if (d && sess && d.from) ident.socket(d.from, sess, d.ts); }
  const resolve = (to: string, ts: string) => { const sess = ident.sessionFor(to); if (sess) return ident.actorAt(sess, ts); const r = roleFromTitle(to); return r ? ensureRole(sink, r) : undefined; };
  const unresolved = () => { sink.actor({ id: 'peer:unresolved', kind: 'session', label: 'another session (not found)', unregistered: true }); return 'peer:unresolved'; };
  for (const s of sink.peerSends) {
    const ex = s.detailRef.extra || {}, d = byMsg.get(String(ex.msgId || ''));
    if (d) { used.add(d); s.target = { kind: 'actor', id: d.receiver }; if (!s.outcome || s.outcome === 'ok') s.outcome = 'delivered'; s.detailRef.extra = { ...ex, delivery: { file: d.file, line: d.line } }; continue; }
    const t = resolve(String(ex.to || ''), s.ts); s.target = { kind: 'actor', id: t || unresolved() }; s.provenance = 'derived'; s.derived = true;
  }
  for (const d of sink.peerDeliveries) {
    if (used.has(d)) continue;
    const from = (d.from && resolve(d.from, d.ts)) || resolve(d.name, d.ts) || unresolved();
    const e = sink.push({ ts: d.ts, actor: sink.ref(from), verb: 'message', target: { kind: 'actor', id: d.receiver }, detailRef: { kind: 'claude-peer-delivery', file: d.file, lines: [d.line] }, source: d.file,
      provenance: 'derived', tsSource: 'record', label: 'peer', outcome: 'delivered', hints: d.body ? [d.body] : [] });
    sink.peerSends.push(e);
  }
  // a message back to a session that wrote to this one in the last 24 h is a reply
  const all = sink.peerSends.filter(e => e.target?.id && !e.target.id.startsWith('peer:')).sort((a, b) => a.ts.localeCompare(b.ts));
  all.forEach((e, i) => { if (all.slice(0, i).some(p => p.actor.id === e.target!.id && p.target!.id === e.actor.id && Date.parse(e.ts) - Date.parse(p.ts) < 864e5)) e.label = 'peer-reply'; });
}

// Critic runs spooled before office-codex recorded its caller: the caller is the session whose Bash call launched it (a command
// naming office-codex, ask-critic or `codex exec`, at most 3 minutes before the run started). Derived; else it stays inferred.
export function linkCriticCallers(sink: Sink) {
  const launches = sink.events.filter(e => /^(coordinator|role:[a-z][a-z-]*|session:[0-9a-f]+)$/.test(e.actor.id) && (e.verb === 'dispatch' || e.verb === 'read' || e.verb === 'write') && (e.hints || []).some(h => /office-codex|ask-critic|\bcodex\s+exec\b/.test(h)));
  for (const m of sink.events.filter(e => e.detailRef.kind === 'spool-codex' && e.verb === 'message' && e.target?.id === 'critic' && e.provenance === 'inferred')) {
    const t = Date.parse(m.ts), l = launches.filter(e => Date.parse(e.ts) <= t + 5e3 && t - Date.parse(e.ts) <= 180e3).sort((a, b) => b.ts.localeCompare(a.ts))[0]; if (!l) continue;
    m.actor = l.actor; m.provenance = 'derived'; m.derived = true; m.detailRef.extra = { ...m.detailRef.extra, callerLinked: true };
    // the ruling is captured, but whom it went to was linked by launch time: a heuristic hand-off (review item 8)
    for (const e of sink.events) if (e.detailRef.kind === 'spool-codex' && e.detailRef.key === m.detailRef.key && e.verb === 'end' && e.actor.id === 'critic') { e.target = { kind: 'actor', id: l.actor.id }; e.detailRef.extra = { ...e.detailRef.extra, callerLinked: true }; }
  }
}

// research/ (A5): PSRI commissions and syntheses copied into the repo. PSRI's own work (~/Desktop/PSRI) is off the allowlist,
// so only the hand-offs show: a session writing a commission or brief into research/<topic>/ messages PSRI; a synthesis
// appearing in that folder is PSRI delivering back to whoever commissioned it (matched by folder).
const COMMISSION = /(commission|brief|request|question)/i, SYNTHESIS = /(synthesis|report|findings|answer|result)/i;
export function researchEvents(sink: Sink, allow: Allowlist, files: string[]) {
  const root = allow.roots.research, topic = (p: string) => { const r = path.relative(root, p).split(path.sep); return r.length >= 2 && r[0] !== '..' ? r[0] : ''; };
  const titles = new Map<string, string>(), by = new Map<string, OfficeEvent[]>();
  const writes = sink.events.filter(e => e.verb === 'write' && e.target?.path && topic(e.target.path) && COMMISSION.test(path.basename(e.target.path))).sort((a, b) => a.ts.localeCompare(b.ts));
  for (const w of writes) {
    if ((by.get(topic(w.target!.path!)) || []).some(x => x.actor.id === w.actor.id && x.target?.path === w.target!.path)) continue; // one hand-off per file per writer
    const e = sink.push({ ts: w.ts, actor: w.actor, verb: 'message', target: { kind: 'actor', id: 'psri', path: w.target!.path, title: fileTitle(w.target!.path!, allow, titles) }, detailRef: { kind: 'research', file: w.target!.path!, lines: [], extra: { of: w.id } },
      source: w.source, provenance: w.provenance === 'captured' ? 'derived' : 'inferred', tsSource: w.tsSource, label: 'commission', hints: [w.target!.path!] });
    (by.get(topic(w.target!.path!)) || by.set(topic(w.target!.path!), []).get(topic(w.target!.path!))!).push(e);
  }
  for (const f of files.filter(f => topic(f) && SYNTHESIS.test(path.basename(f)) && !COMMISSION.test(path.basename(f)))) {
    const ts = fs.statSync(f).mtime.toISOString(), cs = by.get(topic(f)) || [], c = [...cs].reverse().find(x => x.ts <= ts) || cs[0];
    sink.push({ ts, actor: sink.ref('psri'), verb: c ? 'message' : 'write', target: c ? { kind: 'actor', id: c.actor.id, path: f, title: fileTitle(f, allow, titles) } : { kind: 'file', id: f, path: f },
      detailRef: { kind: 'research', file: f, lines: [] }, source: f, provenance: 'inferred', tsSource: 'mtime', label: 'delivery', hints: [f] });
  }
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
  const dirs = (root: string) => { try { return new Set(fs.readdirSync(root).filter(n => /^\w[\w.-]*$/.test(n) && fs.lstatSync(path.join(root, n)).isDirectory())); } catch { return new Set<string>(); } };
  const things = dirs(allow.roots.work), topics = dirs(allow.roots.research);
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
    // O4: work/<thing>/ and research/<topic>/ folders are operations of their own
    for (const m of s.matchAll(/(?:^|[^\w.-])work\/(\w[\w.-]*)/g)) if (things.has(m[1])) out.push('work/' + m[1]);
    for (const m of s.matchAll(/(?:^|[^\w.-])research\/(\w[\w.-]*)\//g)) if (topics.has(m[1])) out.push('research/' + m[1]);
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
  // a session's event with no path of its own rides on that session's previous operation for 2 minutes (Deniz's prompt: the
  // session he wrote to). Per session node, so two sessions working side by side don't lend each other operations.
  const prev = new Map<string, OfficeEvent>(), lane = (e: OfficeEvent) => e.actor.id === 'deniz' ? (e.target?.id || 'deniz') : e.actor.id;
  const sessionLike = (id: string) => id === 'coordinator' || id === 'deniz' || id.startsWith('role:') || id.startsWith('session:');
  for (const e of sink.events.slice().sort((a, b) => a.ts.localeCompare(b.ts) || a.seq - b.seq)) {
    if (e.operation) { if (sessionLike(e.actor.id)) prev.set(lane(e), e); continue; }
    const own = sink.actors.get(e.actor.id), tgt = e.target?.kind === 'actor' ? sink.actors.get(e.target.id) : undefined, p = prev.get(lane(e));
    const op = (!own?.permanent && own?.operation) || (e.verb === 'spawn' && tgt?.operation) || evOps.get(e)
      || (sessionLike(e.actor.id) ? (p && p.operation && Date.parse(e.ts) - Date.parse(p.ts) < 120e3 ? p.operation : undefined) : undefined);
    if (op) { e.operation = op; e.opInferred = true; }
    if (sessionLike(e.actor.id)) prev.set(lane(e), e);
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
  return byActivity([...ids].sort().map(id => {
    const evs = events.filter(e => e.operation === id || e.operation?.startsWith(id + '/'));
    const cov: Coverage = { captured: 0, derived: 0, inferred: 0, gaps: 0, events: evs.length };
    for (const e of evs) if (e.gap) cov.gaps++; else cov[e.provenance as Provenance]++;
    const run: { step: string; first: string; count: number }[] = []; let last = '';
    for (const e of evs) { const s = STEP(e, actors); if (!s || s === last) continue; last = s; const r = run.find(x => x.step === s && run[run.length - 1] === x); if (r) r.count++; else run.push({ step: s, first: e.ts, count: 1 }); }
    const t = opTitle(id, allow);
    return { id, label: id.replace(/\//g, ' · '), title: t.title, ...(t.packet ? { packet: t.packet } : {}), inferred: evs.every(e => e.opInferred !== false), start: evs[0]?.ts || '', end: evs[evs.length - 1]?.ts || '', coverage: cov,
      actors: new Set(evs.map(e => e.actor.id)).size, workflow: { template: { source: 'template' as const, steps: TEMPLATE }, run: { source: 'events' as const, steps: run } } };
  }).filter(o => o.coverage.events));
}
// Tree order, newest first: siblings by latest activity (a parent's covers its children), each followed by its own subtree.
function byActivity<T extends { id: string; end: string }>(ops: T[]): T[] {
  const parent = (id: string) => id.split('/').slice(0, -1).join('/'), kids = new Map<string, T[]>(), known = new Set(ops.map(o => o.id));
  for (const o of ops) { const p = known.has(parent(o.id)) ? parent(o.id) : ''; kids.set(p, [...(kids.get(p) || []), o]); }
  const walk = (p: string): T[] => (kids.get(p) || []).sort((a, b) => b.end.localeCompare(a.end) || a.id.localeCompare(b.id)).flatMap(o => [o, ...walk(o.id)]);
  return walk('');
}
export { hid };
