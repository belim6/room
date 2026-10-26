import fs from 'node:fs';
import type { Sink, Actor } from './types.ts';

// Sessions by role (O4). A Claude session is identified by its session id: the transcript file name, `session_id` in hook
// payloads, and CLAUDE_CODE_SESSION_ID in its tools' environment. Its role comes from, in order:
//   registry : roles/sessions.json, written only by office/bin/register-session (captured: the session said so itself)
//   title    : its Claude Desktop title (custom-title records) when that title is a role name (derived)
//   primary  : the pre-O4 coordinator session (largest transcript), before any of the above applies (inferred)
// Anything else stays "session ‹id›", unregistered. One node per role: forks and rotations are sessions of that node.
export const ROLES = ['partner', 'coordinator', 'prompter', 'experimenter', 'engineer', 'operator', 'housekeeper', 'secretary', 'critic', 'jev-correspondent', 'brainstormer', 'intern'] as const;
export type Role = typeof ROLES[number];
export const isRole = (r: unknown): r is Role => typeof r === 'string' && (ROLES as readonly string[]).includes(r);
export const roleActorId = (r: Role) => r === 'coordinator' || r === 'critic' ? r : 'role:' + r;
export const roleLabel = (r: Role) => r === 'coordinator' ? 'Coordinator (Claude)' : r === 'critic' ? 'Critic (Codex)' : r[0].toUpperCase() + r.slice(1).replace(/-/g, ' ');
// a role node named without any session of its own (a message to "housekeeper" from a session not on file)
export const ensureRole = (sink: Sink, r: Role) => { const id = roleActorId(r); if (!sink.actors.get(id)?.permanent) sink.actor({ id, kind: r, label: roleLabel(r), permanent: true }); return id; };
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const sessionActorId = (s: string) => 'session:' + s.slice(0, 8);
// "experimenter1", "Operator", "critic 2", "Jev correspondent", "intern 3" name a role; "experiment2", "brainstorm" or an auto title do not.
export const roleFromTitle = (t?: string): Role | undefined => { const s = String(t || '').trim().toLowerCase().replace(/[\s_-]*\d+$/, '').replace(/[\s_]+/g, '-'); return isRole(s) ? s : undefined; };

export interface RegEntry { session: string; role: Role; since: string; socket?: string }
// Accepts the command's own format {version, entries:[{session, role, since, …}]}, plus a hand-kept map {sessions:{id:{role,since}}}
// or {id:{role,since}} as the coordinator's fallback. Malformed entries are skipped and counted, never guessed.
export function readRegistry(file?: string): { entries: RegEntry[]; skipped: number; error?: string } {
  if (!file) return { entries: [], skipped: 0 };
  let raw: any; try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e: any) { return { entries: [], skipped: 0, ...(e?.code === 'ENOENT' ? {} : { error: 'registry is not valid JSON' }) }; }
  const list: any[] = Array.isArray(raw?.entries) ? raw.entries : Object.entries(raw?.sessions && typeof raw.sessions === 'object' ? raw.sessions : raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {})
    .flatMap(([session, v]: [string, any]) => (Array.isArray(v) ? v : [v]).map(x => ({ ...x, session })));
  const entries: RegEntry[] = []; let skipped = 0;
  for (const x of list) {
    if (!x || typeof x !== 'object' || x.session === 'version') continue;
    const ok = UUID.test(String(x.session)) && isRole(x.role) && Number.isFinite(Date.parse(x.since));
    if (!ok) { skipped++; continue; }
    entries.push({ session: String(x.session).toLowerCase(), role: x.role, since: new Date(x.since).toISOString(), ...(typeof x.socket === 'string' && /^\/[\w./-]{1,200}\.sock$/.test(x.socket) ? { socket: x.socket } : {}) });
  }
  return { entries: entries.sort((a, b) => a.since.localeCompare(b.since)), skipped };
}

type Via = 'registry' | 'title' | 'primary' | 'none' | 'codex';
interface Span { id: string; from: string; to: string; via: Via; kind: 'claude' | 'codex' }
export class Identity {
  private reg = new Map<string, RegEntry[]>(); spans = new Map<string, Map<string, Span>>(); titles = new Map<string, Set<string>>(); timeline = new Map<string, { ts: string; title: string }[]>(); sockets = new Map<string, { session: string; ts: string }[]>();
  private primary?: string; early = new Map<string, { role: Role; until: string }>();
  constructor(entries: RegEntry[] = [], primary?: string) {
    this.primary = primary;
    for (const e of entries) { (this.reg.get(e.session) || this.reg.set(e.session, []).get(e.session)!).push(e); if (e.socket) this.socket('uds:' + e.socket, e.session, e.since); }
  }
  // The role a session holds at time ts, given the Desktop title in effect at that point of its transcript.
  roleAt(session: string, ts: string, title?: string): { role?: Role; via: Via } {
    // the first registration also covers the moments before it (a session registers as its first step); later ones from their since
    const es = this.reg.get(session.toLowerCase()) || [], r = [...es].reverse().find(e => e.since <= ts) || es[0]; if (r) return { role: r.role, via: 'registry' };
    const t = roleFromTitle(title); if (t) return { role: t, via: 'title' };
    const early = this.early.get(session); if (early && ts <= early.until) return { role: early.role, via: 'title' };
    if (this.primary && session === this.primary) return { role: 'coordinator', via: 'primary' };
    return { via: 'none' };
  }
  // The actor an event of this session belongs to; records which sessions make up each role node.
  actorAt(session: string, ts: string, title = this.titleAt(session, ts)): string {
    const { role, via } = this.roleAt(session, ts, title), id = role ? roleActorId(role) : sessionActorId(session);
    this.span(id, session, ts, via, 'claude'); return id;
  }
  span(actor: string, session: string, ts: string, via: Via, kind: Span['kind']) {
    const m = this.spans.get(actor) || this.spans.set(actor, new Map()).get(actor)!, s = m.get(session);
    if (!s) m.set(session, { id: session, from: ts, to: ts, via, kind }); else { if (ts < s.from) s.from = ts; if (ts > s.to) s.to = ts; if (via === 'registry') s.via = via; }
  }
  // a Desktop title as seen in the transcript; ts = the last timestamped record before it (title records carry none)
  title(session: string, t: string, ts = '') { if (!t) return; (this.titles.get(t) || this.titles.set(t, new Set()).get(t)!).add(session);
    const l = this.timeline.get(session) || this.timeline.set(session, []).get(session)!; if (l[l.length - 1]?.title !== t) l.push({ ts, title: t }); }
  // a session renamed to a role within its first 15 minutes was that role from its start (Deniz names a session right after
  // opening it): its earlier events move from the unregistered node to the role node
  setEarly(session: string, role: Role, until: string, first: string) {
    this.early.set(session, { role, until }); const from = this.spans.get(sessionActorId(session)), s = from?.get(session);
    if (s) { from!.delete(session); if (!from!.size) this.spans.delete(sessionActorId(session)); this.span(roleActorId(role), session, s.from, 'title', 'claude'); this.span(roleActorId(role), session, s.to, 'title', 'claude'); }
    else this.span(roleActorId(role), session, first, 'title', 'claude');
  }
  titleAt(session: string, ts: string) { let t: string | undefined; for (const x of this.timeline.get(session) || []) if (x.ts <= ts) t = x.title; return t; }
  socket(addr: string, session: string, ts: string) { const l = this.sockets.get(addr) || this.sockets.set(addr, []).get(addr)!; if (!l.some(x => x.session === session)) l.push({ session, ts }); }
  // A SendMessage recipient: a socket address seen for exactly one session, or a Desktop title that exactly one session carried.
  sessionFor(to: string): string | undefined {
    const s = to.startsWith('uds:') ? this.sockets.get(to)?.map(x => x.session) : [...(this.titles.get(to) || [])];
    return s && new Set(s).size === 1 ? s[0] : undefined;
  }
  // Role nodes and unregistered session nodes. Sessions are listed in order; a later session of the same node is its successor.
  apply(sink: Sink) {
    for (const id of [...sink.actors.keys()]) if (id.startsWith('session:') && !this.spans.has(id)) sink.actors.delete(id); // moved to a role (setEarly)
    for (const [id, m] of this.spans) {
      const sessions = [...m.values()].sort((a, b) => a.from.localeCompare(b.from)).map(s => ({ id: s.id, from: s.from, to: s.to, via: s.via, kind: s.kind }));
      if (id.startsWith('session:')) { sink.actor({ id, kind: 'session', label: 'session ' + id.slice(8), unregistered: true, sessions } as Actor); continue; }
      const role = (id.startsWith('role:') ? id.slice(5) : id) as Role;
      sink.actor({ id, kind: role, label: roleLabel(role), permanent: true, sessions } as Actor);
    }
  }
}
