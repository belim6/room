import crypto from 'node:crypto';

export type Provenance = 'captured' | 'derived' | 'inferred';
export type Verb = 'spawn' | 'end' | 'read' | 'write' | 'message' | 'dispatch' | 'turn' | 'rule' | 'wait' | 'block' | 'unblock' | 'error' | 'deviation';
export interface ActorRef { id: string; kind: string; label: string; parent?: string; name?: string }
export interface SessionSpan { id: string; from: string; to: string; via: string; kind: string }
export interface Actor extends ActorRef { name?: string; permanent?: boolean; operation?: string; parentInferred?: boolean; source?: string; unregistered?: boolean; sessions?: SessionSpan[] }
export interface Target { kind: string; id: string; path?: string; group?: string; title?: string }
// Points back to the exact source lines; Expand re-reads them. kind names the expander.
export interface DetailRef { kind: string; file: string; lines: number[]; key?: string; extra?: Record<string, unknown> }
export interface OfficeEvent {
  id: string; seq: number; ts: string; until?: string; actor: ActorRef; verb: Verb; target?: Target;
  operation?: string; opInferred?: boolean; cost?: { calls?: number; tokens?: number; ms?: number };
  detailRef: DetailRef; source: string; derived: boolean; provenance: Provenance;
  outcome?: string; tsSource?: 'record' | 'mtime' | 'interpolated' | 'linked'; label?: string;
  findings?: number; step?: string;   hints?: string[]; gap?: { direction: 'log-without-action' | 'action-without-log'; ref?: string };
}
export interface SourceStat { kind: string; path: string; records: number; events: number; unparsed: number; note?: string }
export interface Artifact { path: string; group: string; size: number; mtime: string; operation?: string }

export const hid = (...parts: (string | number)[]) => crypto.createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 16);

export const PERMANENT: Actor[] = [
  { id: 'deniz', kind: 'human', label: 'Deniz', permanent: true },
  { id: 'coordinator', kind: 'coordinator', label: 'Coordinator (Claude)', permanent: true },
  { id: 'critic', kind: 'critic', label: 'Critic (Codex)', permanent: true },
  { id: 'server', kind: 'server', label: 'Stable server :4317', permanent: true },
  { id: 'rooms', kind: 'artifact', label: 'Rooms', permanent: true },
  { id: 'vault', kind: 'artifact', label: 'Vault', permanent: true },
  { id: 'ledger', kind: 'artifact', label: 'Ledger', permanent: true },
  { id: 'archive', kind: 'artifact', label: 'Archive', permanent: true },
  { id: 'repo', kind: 'artifact', label: 'Code', permanent: true },
  { id: 'outside', kind: 'artifact', label: 'Elsewhere', permanent: true },
  { id: 'transcripts', kind: 'artifact', label: 'Transcripts', permanent: true },
  { id: 'work', kind: 'artifact', label: 'Work', permanent: true },
  { id: 'psri', kind: 'external', label: 'PSRI (research)', permanent: true },
  { id: 'providers', kind: 'provider', label: 'Providers', permanent: true },
];

// Collector context shared by parsers: one mutable sink, filled in deterministic file order.
export class Sink {
  events: OfficeEvent[] = []; actors = new Map<string, Actor>(); sources: SourceStat[] = [];
  lineIndex = new Map<string, number[]>();
  toolOwner = new Map<string, OfficeEvent>(); // tool_use id -> event (spawn/dispatch) for linking
  agentSpawn = new Map<string, OfficeEvent>(); // sub-agent id -> spawn event
  seenRecords = new Set<string>(); // transcript record uuids: a forked session repeats its parent's history, which is counted once
  peerSends: OfficeEvent[] = []; peerDeliveries: { msgId: string; from: string; name: string; ts: string; receiver: string; session: string; file: string; line: number; body?: string }[] = [];
  coordinatorCalls: OfficeEvent[] = []; // coordinator tool-call events, for cross-checks and codex linking
  constructor() { for (const a of PERMANENT) this.actors.set(a.id, a); }
  actor(a: Actor) { const cur = this.actors.get(a.id); if (!cur) this.actors.set(a.id, a); else Object.assign(cur, Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined))); return this.actors.get(a.id)!; }
  ref(id: string): ActorRef { const a = this.actors.get(id) || this.actor({ id, kind: id.startsWith('agent:') ? 'engineer' : 'unknown', label: id.replace(/^\w+:/, '').slice(0, 24) }); return { id: a.id, kind: a.kind, label: a.label, ...(a.name ? { name: a.name } : {}), ...(a.parent ? { parent: a.parent } : {}) }; }
  private ids = new Set<string>();
  push(e: Omit<OfficeEvent, 'id' | 'seq' | 'derived'>) {
    const base = hid(e.source, e.detailRef.lines.join(','), e.verb, e.actor.id, e.target?.id || '', e.target?.path || '');
    let id = base, n = 1; while (this.ids.has(id)) id = base + '-' + n++;
    this.ids.add(id);
    const ev = { ...e, id, seq: this.events.length, derived: e.provenance !== 'captured' } as OfficeEvent;
    this.events.push(ev); return ev;
  }
}
