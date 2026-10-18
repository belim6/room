import fs from 'node:fs';
import path from 'node:path';
import type { Collected } from './index';
import type { OfficeEvent } from './types';

// Workflow graph (spec 76 §1 + amendment P2). An operation's events are matched onto its template's steps:
//  direct    : the event names its step (events.jsonl `step`);
//  heuristic : exactly one step's rules fit the event in its round's context (verb, actor, file kind, position);
//  unplanned : no step fits, or more than one does (the ambiguity rule). Never assigned arbitrarily.
// Loop counts use only direct and unambiguous heuristic matches, and report the split.
export interface Rule { verb?: string; actor?: string; actorKind?: string; targetKind?: string; file?: string; source?: string; kind?: string; fromNot?: string; hint?: string;
  verdict?: boolean; newPacket?: boolean; planPacket?: boolean; firstInRound?: boolean; notFirstInRound?: boolean; after?: string; before?: string }
export interface Step { id: string; title: string; loop?: string; rules: Rule[] }
export interface Template { id: string; title: string; about?: string; applies: string; round: string; steps: Step[]; loops: { id: string; steps: string[]; title: string; count: string[] }[] }
export const WORKFLOW_DIR = path.join(__dirname, '..', 'workflows');
const ORDER = ['labeling', 'experiment-cycle', 'build-release']; // most specific first
export function loadTemplates(dir = WORKFLOW_DIR): Template[] {
  const all = fs.readdirSync(dir).filter(n => n.endsWith('.json')).map(n => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')) as Template);
  return all.sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99) || a.id.localeCompare(b.id));
}
export const templateFor = (opId: string, tpls = loadTemplates()) => tpls.find(t => new RegExp(t.applies).test(opId));

const PACKET = /\/\d\d[a-z]?-[^/]*\.md$/;
// The events that belong to an operation's workflow: its own subtree, writes/reads of its folder and of the day-level
// packets that belong to it, and the critic sessions that read any of those.
export function scopeEvents(c: Collected, opId: string): OfficeEvent[] {
  const inOp = (o?: string) => !!o && (o === opId || o.startsWith(opId + '/'));
  const folder = path.join(c.allow.roots.coordination, opId), packets = new Set(c.artifacts.filter(a => inOp(a.operation) && PACKET.test(a.path)).map(a => a.path));
  const touches = (e: OfficeEvent) => { const p = e.target?.path; return !!p && (packets.has(p) || p.toLowerCase().startsWith(folder.toLowerCase() + path.sep)); };
  // a critic session belongs here if it read one of this operation's packets, or its own file names this operation
  const parts = opId.split('/'), [day, sub] = parts, slugHere = (id: string) => parts.length === 2 && new RegExp(`^critic:critic-${day}-${sub}(\\b|-|$)`).test(id);
  const critics = new Set(c.events.filter(e => /^(critic:|codexrun:)/.test(e.actor.id) && e.actor.kind === 'critic' && ((e.target?.path && packets.has(e.target.path)) || slugHere(e.actor.id))).map(e => e.actor.id));
  const isCritic = (id?: string) => !!id && /^(critic:|codexrun:)/.test(id) && c.actors.get(id)?.kind === 'critic';
  return c.events.filter(e => {
    if (isCritic(e.actor.id) || (e.verb === 'spawn' && isCritic(e.target?.id))) return critics.has(e.actor.id) || critics.has(e.target?.id || ''); // critics: only by the rule above
    return inOp(e.operation) || (touches(e) && (e.actor.id === 'coordinator' || e.actor.id.startsWith('session:')));
  });
}

interface Rec { id: string; ts: string; match: 'direct' | 'heuristic'; outcome?: string; evidence?: string }
interface Round { n: number; pos: number; plan?: string; matches: Map<string, Rec[]> }
export function matchWorkflow(c: Collected, opId: string, tpls = loadTemplates()) {
  const tpl = templateFor(opId, tpls); if (!tpl) return null;
  const idx = new Map(tpl.steps.map((s, i) => [s.id, i]));
  // {phase}: the sub-operation's suffix (…/labeling-compare → compare; …/labeling → any)
  const phaseRe = (opId.split('/').pop()!.match(/^(?:labeling|run)-([\w]+)$/) || [])[1] || '[^/]*', fileRe = (f: string) => new RegExp(f.replace(/\{phase\}/g, phaseRe), 'i');
  const evs = scopeEvents(c, opId).sort((a, b) => a.ts.localeCompare(b.ts) || a.seq - b.seq);
  const rounds: Round[] = [{ n: 1, pos: -1, matches: new Map() }], unplanned: { id: string; ts: string; reason: string; candidates?: string[] }[] = [], seenPackets = new Set<string>();
  const kindOf = (id?: string) => (id && c.actors.get(id)?.kind) || '';
  const who = (name: string) => name === 'critic' ? 'critic' : name;
  const loopCount = (r: Round, loop?: string) => loop ? (tpl.loops.find(l => l.id === loop)?.count || []).reduce((n, s) => n + (r.matches.get(s)?.length || 0), 0) : 0;
  const fits = (rule: Rule, e: OfficeEvent, r: Round, step: Step) => {
    const p = e.target?.path || '';
    if (rule.verb && e.verb !== rule.verb) return false;
    if (rule.actor && e.actor.id !== rule.actor) return false;
    if (rule.actorKind && e.actor.kind !== rule.actorKind) return false;
    if (rule.targetKind && kindOf(e.target?.kind === 'actor' ? e.target.id : undefined) !== rule.targetKind) return false;
    if (rule.file && !(p && fileRe(rule.file).test(p))) return false;
    if (rule.source === 'handoff' && e.detailRef.kind !== 'handoff') return false;
    if (rule.kind && !new RegExp(`^(${rule.kind})$`).test(e.label || '')) return false;
    if (rule.fromNot && e.actor.id === who(rule.fromNot)) return false;
    if (rule.hint && !new RegExp(rule.hint).test((e.hints || []).join('\n'))) return false;
    if (rule.verdict && !/^(go|no-go|conditional-go)$/.test(e.outcome || '')) return false;
    if (rule.newPacket && seenPackets.has(p)) return false;
    if (rule.planPacket && p !== r.plan) return false;
    if (rule.firstInRound && loopCount(r, step.loop) > 0) return false;
    if (rule.notFirstInRound && loopCount(r, step.loop) === 0) return false;
    if (rule.after && !(r.pos >= (idx.get(rule.after) ?? 99))) return false;
    if (rule.before && !(r.pos < (idx.get(rule.before) ?? -1))) return false;
    return true;
  };
  // coverage gaps (deviation) have their own badge; they are not workflow steps
  const significant = (e: OfficeEvent) => e.detailRef.kind === 'handoff' || (e.actor.kind === 'critic' && e.verb === 'end') || ['error', 'block'].includes(e.verb)
    || (e.verb === 'write' && PACKET.test(e.target?.path || ''));
  const record = (r: Round, step: string, rec: Rec) => { (r.matches.get(step) || r.matches.set(step, []).get(step)!).push(rec); r.pos = Math.max(r.pos, idx.get(step)!); };
  for (const e of evs) {
    let r = rounds[rounds.length - 1], step: string | undefined, match: Rec['match'] = 'heuristic';
    if (e.step && idx.has(e.step)) { step = e.step; match = 'direct'; }
    else {
      const cands = tpl.steps.filter(s => s.rules.some(rule => fits(rule, e, r, s))).map(s => s.id);
      if (!cands.length) { if (significant(e)) unplanned.push({ id: e.id, ts: e.ts, reason: 'no step fits' }); continue; }
      if (cands.length > 1) { unplanned.push({ id: e.id, ts: e.ts, reason: 'ambiguous', candidates: cands }); continue; }
      step = cands[0];
    }
    // a new round starts when the round step recurs after the current round has moved past it
    if (step === tpl.round && r.pos > (idx.get(tpl.round) ?? 0)) { r = { n: rounds.length + 1, pos: -1, matches: new Map() }; rounds.push(r); }
    if (step === tpl.round && e.target?.path) { r.plan ??= e.target.path; seenPackets.add(e.target.path); }
    record(r, step, { id: e.id, ts: e.ts, match, outcome: e.outcome });
  }
  // Steps evidenced only by an artifact (a lock written by a script the transcripts can't see): heuristic, from the file,
  // placed in the round that was running at the file's mtime. Files already matched through an event are not counted twice.
  const folder = path.join(c.allow.roots.coordination, opId.split('/').slice(0, 2).join('/')), matchedPaths = new Set(evs.filter(e => rounds.some(r => [...r.matches.values()].flat().some(m => m.id === e.id))).map(e => e.target?.path).filter(Boolean));
  const roundAt = (ts: string) => [...rounds].reverse().find(x => [...x.matches.values()].flat().some(m => m.ts <= ts)) || rounds[0];
  for (const s of tpl.steps) for (const rule of s.rules) {
    if (!rule.file || rule.verb !== 'write' || rule.planPacket || rule.newPacket) continue;
    for (const art of c.artifacts.filter(a => a.path.toLowerCase().startsWith(folder.toLowerCase() + path.sep) && fileRe(rule.file!).test(a.path) && !matchedPaths.has(a.path))) {
      const r = roundAt(art.mtime); if (r.matches.get(s.id)?.length) continue;
      record(r, s.id, { id: '', ts: art.mtime, match: 'heuristic', evidence: art.path }); matchedPaths.add(art.path);
    }
  }
  const last = rounds[rounds.length - 1];
  return {
    op: opId, template: { id: tpl.id, title: tpl.title, about: tpl.about, steps: tpl.steps.map(s => ({ id: s.id, title: s.title, loop: s.loop })), loops: tpl.loops },
    rounds: rounds.filter(r => r.matches.size).map(r => ({
      n: r.n, plan: r.plan,
      steps: tpl.steps.map(s => { const m = r.matches.get(s.id) || []; return { id: s.id, title: s.title, loop: s.loop, status: m.length ? 'done' : 'hollow', current: r === last && m.length > 0 && idx.get(s.id) === r.pos,
        events: m.filter(x => x.id).map(x => x.id), evidence: m.filter(x => x.evidence).map(x => x.evidence), direct: m.filter(x => x.match === 'direct').length, heuristic: m.filter(x => x.match === 'heuristic').length,
        outcomes: m.map(x => x.outcome).filter((o): o is string => !!o && o !== 'ok') }; }),
      loops: tpl.loops.map(l => { const m = l.count.flatMap(s => r.matches.get(s) || []).sort((a, b) => a.ts.localeCompare(b.ts));
        return { id: l.id, title: l.title, count: m.length, direct: m.filter(x => x.match === 'direct').length, heuristic: m.filter(x => x.match === 'heuristic').length, verdicts: m.map(x => x.outcome || '?') }; }),
    })),
    unplanned,
  };
}
export const stepNames = (tpls = loadTemplates()) => Object.fromEntries(tpls.map(t => [t.id, t.steps.map(s => s.id)]));
