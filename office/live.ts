import fs from 'node:fs';
import path from 'node:path';
import { collect, finalize, operations, type Collected } from './collect/index';
import { Sink, type OfficeEvent, type Actor } from './collect/types';
import { parseEvents } from './collect/events';
import { parseManifest } from './collect/manifests';
import { readSpoolTail, buildSpool, spoolFiles, dedupeKey, type SpoolState } from './collect/spool';
import type { Config } from './collect/privacy';
import { UUID } from './collect/roles';

// Live tier. Every second: re-parse the append-only small sources that changed (spool, events.jsonl, driver manifests)
// and merge the new or changed events by id. Transcripts are the fallback and cross-check: when they change, a full
// collect runs at most every `fullMs` and its result is merged the same way. Clients get upserts and removals over SSE
// and fold them with the same renderer as replay.
export const meta = (e: OfficeEvent) => { const { hints, ...m } = e; return m; };
const same = (a: OfficeEvent, b: OfficeEvent) => JSON.stringify({ ...meta(a), seq: 0 }) === JSON.stringify({ ...meta(b), seq: 0 });
export interface LiveOpts { tickMs?: number; fullMs?: number; fullMsWithHooks?: number; roomFeed?: string }
export type Push = (type: string, data: unknown) => void;

export class Live {
  clients = new Set<Push>(); sizes = new Map<string, number>(); spool = new Map<string, SpoolState>(); transcriptSig = ''; lastFull = Date.now(); version = 0; fulls = 0;
  private timer?: NodeJS.Timeout; private feedStop?: () => void; private busy = false;
  constructor(private get: () => Collected, private set: (c: Collected) => void, private cfg: Config, private opts: LiveOpts = {}) {
    for (const f of this.tracked()) { this.sizes.set(f, this.size(f)); if (this.get().allow.isSpool(f)) this.spool.set(f, readSpoolTail(f)); }
    this.transcriptSig = this.sig();
  }
  start() {
    if (this.opts.tickMs) { this.timer = setInterval(() => this.tick(), this.opts.tickMs); this.timer.unref(); }
    if (this.opts.roomFeed) this.feedStop = roomFeed(this.opts.roomFeed, n => this.notice(n));
    return this;
  }
  stop() { if (this.timer) clearInterval(this.timer); this.feedStop?.(); }
  private size(f: string) { try { return fs.statSync(f).size; } catch { return -1; } }
  tracked() {
    const c = this.get().allow.roots, out = [...spoolFiles(c.spool), path.join(c.coordination, 'events.jsonl')];
    const scan = (d: string, depth: number) => { let ns: string[] = []; try { ns = fs.readdirSync(d); } catch { return; }
      for (const n of ns) { const p = path.join(d, n); if (/^manifest-.*\.jsonl$/.test(n)) out.push(p); else if (depth && /^[\w.-]+$/.test(n) && !n.includes('.')) { try { if (fs.lstatSync(p).isDirectory()) scan(p, depth - 1); } catch {} } } };
    scan(c.coordination, 6); scan(c.work, 6); // nested run folders too
    const top = this.cfg.room && path.join(this.cfg.room, 'events.jsonl'); if (top && fs.existsSync(top)) out.push(top);
    return out;
  }
  // Session transcripts and every sub-agent transcript (subagents/**/agent-*.jsonl): sizes and mtimes. Any change, including
  // an agent appending to its own transcript, schedules a full collect (the transcript fallback).
  sig() {
    const root = this.get().allow.roots.claudeProject, parts: string[] = [];
    const walk = (d: string) => { let ns: string[] = []; try { ns = fs.readdirSync(d).sort(); } catch { return; }
      for (const n of ns) { const p = path.join(d, n); let st: fs.Stats; try { st = fs.lstatSync(p); } catch { continue; }
        if (st.isDirectory()) walk(p); else if (/^agent-.*\.jsonl$/.test(n)) parts.push(`${p}:${st.size}:${st.mtimeMs}`); } };
    try { for (const n of fs.readdirSync(root).sort()) { const p = path.join(root, n); const st = fs.statSync(p);
      if (st.isFile() && n.endsWith('.jsonl')) parts.push(`${n}:${st.size}:${st.mtimeMs}`); else if (st.isDirectory()) walk(path.join(p, 'subagents')); } } catch {}
    return parts.join(';');
  }
  // While the hooks are delivering, transcripts only reconcile: the blocking full collect then runs far less often.
  private hooksActive(now: number) { for (const [f, st] of this.spool) if (path.basename(f).startsWith('hooks') && st.lastTs && now - Date.parse(st.lastTs) < 120e3) return true; return false; }
  tick(now = Date.now()) {
    if (this.busy) return; this.busy = true;
    try {
      const changed: string[] = [];
      for (const f of this.tracked()) { const s = this.size(f); if (s !== this.sizes.get(f)) { this.sizes.set(f, s); if (s >= 0) changed.push(f); } }
      // a driver that died mid-pair writes nothing more: re-read its manifest when the held group's wall-time limit passes
      for (const [f, t] of this.get().holdUntil) if (t <= Date.now() && !changed.includes(f)) changed.push(f);
      if (changed.length) this.incremental(changed);
      const sig = this.sig();
      const every = this.hooksActive(now) ? (this.opts.fullMsWithHooks ?? 120000) : (this.opts.fullMs ?? 15000);
      if (sig !== this.transcriptSig && now - this.lastFull >= every) { this.transcriptSig = sig; this.full(); }
    } finally { this.busy = false; }
  }
  incremental(files: string[]) {
    const data = this.get(), allow = data.allow, sink = new Sink(), fileSet = new Set(files);
    for (const [k, a] of data.actors) sink.actors.set(k, { ...a });
    const known = new Set(data.events.filter(e => !fileSet.has(e.source)).map(dedupeKey).filter(Boolean));
    for (const f of files) {
      if (allow.isSpool(f)) { const st = readSpoolTail(f, this.spool.get(f)); this.spool.set(f, st); sink.lineIndex.set(f, st.offs); buildSpool(f, st, sink, allow, { primarySession: data.primarySession, known, ident: data.ident }); }
      else if (path.basename(f) === 'events.jsonl') parseEvents(f, sink, allow);
      else parseManifest(f, sink, allow);
    }
    for (const [f, offs] of sink.lineIndex) data.lineIndex.set(f, offs);
    for (const f of files) { data.holdUntil.delete(f); const t = sink.holdUntil.get(f); if (t !== undefined) data.holdUntil.set(f, t); }
    data.ident.apply(sink);
    const { events } = finalize(sink, this.cfg, allow, false), fresh = new Set(events.map(e => e.id));
    // a re-parsed file replaces its own earlier events: one that is gone (e.g. a spawn whose target was not yet known) is removed
    const removes = data.events.filter(e => fileSet.has(e.source) && !fresh.has(e.id)).map(e => e.id);
    this.merge(events, removes, sink.actors);
  }
  full() {
    const prev = this.get(), next = collect(this.cfg), ids = new Set(next.events.map(e => e.id)); this.fulls++;
    for (const f of spoolFiles(next.allow.roots.spool)) this.spool.set(f, readSpoolTail(f, this.spool.get(f)));
    const removes = prev.events.filter(e => !ids.has(e.id)).map(e => e.id);
    this.lastFull = Date.now(); this.set(next);
    const changed = next.events.filter(e => { const p = prev.byId.get(e.id); return !p || !same(p, e); });
    this.broadcast(changed, removes, [...next.actors.values()].filter(a => JSON.stringify(a) !== JSON.stringify(prev.actors.get(a.id))));
  }
  // Room's ID-only live notices (optional; off unless OFFICE_ROOM_FEED is set). A turn notice becomes a server `turn`.
  notice(n: { kind?: string; id?: string; branch?: string; at?: string }) {
    // Codex privacy P1 (O3 release): only Room's own record ids (UUIDs) pass; any other field of the notice is ignored, so a
    // notice cannot carry turn text or a trajectory id into the metadata tier. The label is fixed.
    if (n.kind !== 'turns' || !UUID.test(String(n.id || ''))) return;
    const data = this.get(), op = UUID.test(String(n.branch || '')) ? data.events.find(e => e.verb === 'write' && e.target?.kind === 'branch' && e.target.id === n.branch)?.operation : undefined;
    const sink = new Sink(); for (const [k, a] of data.actors) sink.actors.set(k, { ...a });
    sink.push({ ts: new Date(typeof n.at === 'string' && Number.isFinite(Date.parse(n.at)) ? n.at : Date.now()).toISOString(), actor: sink.ref('server'), verb: 'turn', target: { kind: 'turn', id: String(n.id).toLowerCase(), group: 'rooms' },
      ...(op ? { operation: op, opInferred: true } : {}), detailRef: { kind: 'room-notice', file: 'room-feed', lines: [], key: String(n.id).toLowerCase() }, source: 'room-feed', provenance: 'captured', tsSource: 'record', label: 'turn (live)' });
    this.merge(sink.events, [], sink.actors);
  }
  merge(incoming: OfficeEvent[], removes: string[], actors: Map<string, Actor>) {
    const data = this.get(), up: OfficeEvent[] = [];
    if (removes.length) { const rm = new Set(removes); data.events = data.events.filter(e => !rm.has(e.id)); for (const id of rm) data.byId.delete(id); }
    for (const e of incoming) { const p = data.byId.get(e.id); if (p && same(p, e)) continue; up.push(e); data.byId.set(e.id, e); if (p) data.events[data.events.indexOf(p)] = e; else data.events.push(e); }
    const newActors: Actor[] = []; for (const [k, a] of actors) { const p = data.actors.get(k); if (!p || JSON.stringify(p) !== JSON.stringify(a)) { data.actors.set(k, a); newActors.push(a); } }
    if (!up.length && !removes.length && !newActors.length) return;
    data.events.sort((a, b) => a.ts.localeCompare(b.ts) || a.seq - b.seq);
    data.operations = operations(data.events, data.actors, data.allow);
    this.broadcast(up, removes, newActors);
  }
  broadcast(up: OfficeEvent[], removes: string[], actors: Actor[]) {
    if (!up.length && !removes.length && !actors.length) return;
    this.version++;
    const msg = { version: this.version, upserts: up.map(meta), removes, actors, operations: this.get().operations };
    for (const c of this.clients) try { c('events', msg); } catch {}
  }
}

export function roomFeed(url: string, on: (n: any) => void) {
  let stopped = false, ctl: AbortController | null = null;
  const loop = async () => {
    while (!stopped) {
      try {
        ctl = new AbortController(); const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'text/event-stream' } });
        const rd = r.body!.getReader(), dec = new TextDecoder(); let buf = '';
        for (;;) { const { done, value } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true });
          let i; while ((i = buf.indexOf('\n\n')) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2);
            const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n'); if (data) try { on(JSON.parse(data)); } catch {} } }
      } catch {}
      if (!stopped) await new Promise(r => setTimeout(r, 2000));
    }
  };
  void loop();
  return () => { stopped = true; ctl?.abort(); };
}
