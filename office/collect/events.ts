import fs from 'node:fs';
import path from 'node:path';
import { Sink, type Verb } from './types';
import { readLines } from './claude';
import { verdictOf } from './codex';
import type { Allowlist } from './privacy';

// coordination/events.jsonl: the coordinator's own handoff log {at,from,to,kind,ref,note,operation?}.
export const HANDOFF_VERB: Record<string, Verb> = { packet: 'message', build: 'dispatch', dispatch: 'dispatch', review: 'message', result: 'message', blocked: 'block', block: 'block',
  unblock: 'unblock', unblocked: 'unblock', wait: 'wait', waiting: 'wait', start: 'spawn', end: 'end', spawn: 'spawn', rule: 'rule', ruling: 'rule', error: 'error', deviation: 'deviation', read: 'read', write: 'write', message: 'message' };
export const WHO: Record<string, string> = { claude: 'coordinator', coordinator: 'coordinator', deniz: 'deniz', critic: 'critic', stable: 'server', server: 'server' };
export function who(sink: Sink, name: string) {
  const id = WHO[name]; if (id) return id;
  const a = 'role:' + name; sink.actor({ id: a, kind: /review/.test(name) ? 'reviewer' : /engineer/.test(name) ? 'engineer' : /label/.test(name) ? 'labeler' : /writer/.test(name) ? 'writer' : 'unknown', label: name, parent: 'coordinator', parentInferred: true });
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
      ...(r.operation ? { operation: String(r.operation), opInferred: false } : {}), detailRef: { kind: 'handoff', file, lines: [i], ...(ref ? { extra: { ref: allow.canonical(ref) } } : {}) },
      source: file, provenance: 'captured', tsSource: 'record', label: r.kind, ...(outcome ? { outcome } : {}), hints: [ref || '', String(r.ref || '')] });
    stat.events++;
  });
}
