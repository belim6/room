import fs from 'node:fs';
import path from 'node:path';
import { Sink, hid, type Verb } from './types';
import { readLines } from './claude';
import { verdictOf } from './codex';
import type { Allowlist } from './privacy';
import { isRole, ensureRole } from './roles';

// coordination/events.jsonl: the coordinator's own handoff log {at,from,to,kind,ref,note,operation?}.
export const HANDOFF_VERB: Record<string, Verb> = { packet: 'message', build: 'dispatch', dispatch: 'dispatch', review: 'message', result: 'message', blocked: 'block', block: 'block',
  unblock: 'unblock', unblocked: 'unblock', wait: 'wait', waiting: 'wait', start: 'spawn', end: 'end', spawn: 'spawn', rule: 'rule', ruling: 'rule', error: 'error', deviation: 'deviation', read: 'read', write: 'write', message: 'message' };
export const WHO: Record<string, string> = { claude: 'coordinator', coordinator: 'coordinator', deniz: 'deniz', critic: 'critic', stable: 'server', server: 'server' };
export function who(sink: Sink, name: string) {
  const k = name.trim().toLowerCase(), id = WHO[k]; if (id) return id; name = k;
  if (isRole(name)) return ensureRole(sink, name); // O4: the role nodes (partner, operator, …); kinds and labels come from roles.ts
  if (name === 'psri') return 'psri';
  // anything else is free text written by an agent: never a label or a role (review item 5). One opaque node per distinct value.
  const h = hid('events-actor', name).slice(0, 8), a = 'actor:' + h; sink.actor({ id: a, kind: 'unknown', label: 'unknown actor ' + h, parent: 'coordinator', parentInferred: true });
  return a;
}
export function parseEvents(file: string, sink: Sink, allow: Allowlist) {
  const stat = { kind: 'coordination-events', path: file, records: 0, events: 0, unparsed: 0 }; sink.sources.push(stat);
  if (!fs.existsSync(file)) { stat.unparsed = 0; return; }
  readLines(file, sink).forEach((l, i) => {
    if (!l.trim()) return; let r: any; try { r = JSON.parse(l); } catch { stat.unparsed++; return; }
    if (!r.at || !r.from || !r.kind || !Number.isFinite(Date.parse(r.at))) { stat.unparsed++; return; } stat.records++;
    const verb = HANDOFF_VERB[r.kind] || 'message', ref = r.ref ? path.resolve(allow.cfg.coordination, String(r.ref)) : undefined;
    const outcome = r.kind === 'review' || r.kind === 'result' ? verdictOf(String(r.note || '')) : r.kind === 'blocked' ? 'blocked' : undefined;
    sink.push({ ts: new Date(r.at).toISOString(), actor: sink.ref(who(sink, String(r.from))), verb, target: r.to ? { kind: 'actor', id: who(sink, String(r.to)), ...(ref ? { path: allow.canonical(ref) } : {}) } : undefined,
      ...(r.operation ? { operation: String(r.operation), opInferred: false } : {}), ...(typeof r.step === 'string' && /^[a-z][a-z0-9-]{0,40}$/.test(r.step) ? { step: r.step } : {}), detailRef: { kind: 'handoff', file, lines: [i], ...(ref ? { extra: { ref: allow.canonical(ref) } } : {}) },
      source: file, provenance: 'captured', tsSource: 'record', label: r.kind, ...(outcome ? { outcome } : {}), hints: [ref || '', String(r.ref || '')] });
    stat.events++;
  });
}
