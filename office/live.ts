import fs from 'node:fs';
import path from 'node:path';
import { collect, finalize, operations, type Collected } from './collect/index';
import { Sink, type OfficeEvent, type Actor } from './collect/types';
import { parseEvents } from './collect/events';
import { parseManifest } from './collect/manifests';
import { parseSpool, spoolFiles, dedupeKey } from './collect/spool';
import type { Config } from './collect/privacy';

// Live tier. Every second: re-parse the append-only small sources that changed (spool, events.jsonl, driver manifests)
// and merge the new or changed events by id. Transcripts are the fallback and cross-check: when they change, a full
// collect runs at most every `fullMs` and its result is merged the same way. Clients get upserts and removals over SSE
// and fold them with the same renderer as replay.
export const meta = (e: OfficeEvent) => { const { hints, ...m } = e; return m; };
const same = (a: OfficeEvent, b: OfficeEvent) => JSON.stringify({ ...meta(a), seq: 0 }) === JSON.stringify({ ...meta(b), seq: 0 });
export interface LiveOpts { tickMs?: number; fullMs?: number; roomFeed?: string }
export type Push = (type: string, data: unknown) => void;

export class Live {
  clients = new Set<Push>(); sizes = new Map<string, number>(); transcriptSig = ''; lastFull = Date.now(); version = 0;
  private timer?: NodeJS.Timeout; private feedStop?: () => void; private busy = false;
  constructor(private get: () => Collected, private set: (c: Collected) => void, private cfg: Config, private opts: LiveOpts = {}) {
    for (const f of this.tracked()) this.sizes.set(f, this.size(f));
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
    scan(c.coordination, 2);
    return out;
  }
  // Session transcripts and sub-agent dirs: size/mtime signature only (cheap); a change schedules a full collect.
  private sig() {
    const root = this.get().allow.roots.claudeProject; let s = '';
    try { for (const n of fs.readdirSync(root).sort()) { const p = path.join(root, n); const st = fs.statSync(p); s += `${n}:${st.size}:${st.mtimeMs};`;
      const sub = path.join(p, 'subagents'); if (st.isDirectory() && fs.existsSync(sub)) s += `${fs.statSync(sub).mtimeMs};`; } } catch {}
    return s;
  }
  tick(now = Date.now()) {
    if (this.busy) return; this.busy = true;
    try {
      const changed: string[] = [];
      for (const f of this.tracked()) { const s = this.size(f); if (s !== this.sizes.get(f)) { this.sizes.set(f, s); if (s >= 0) changed.push(f); } }
      if (changed.length) this.incremental(changed);
      const sig = this.sig();
      if (sig !== this.transcriptSig && now - this.lastFull >= (this.opts.fullMs ?? 15000)) { this.transcriptSig = sig; this.full(); }
    } finally { this.busy = false; }
  }
  incremental(files: string[]) {
    const data = this.get(), allow = data.allow, sink = new Sink(), fileSet = new Set(files);
    for (const [k, a] of data.actors) sink.actors.set(k, { ...a });
    const known = new Set(data.events.filter(e => !fileSet.has(e.source)).map(dedupeKey).filter(Boolean));
    for (const f of files) {
      if (allow.isSpool(f)) parseSpool(f, sink, allow, { primarySession: data.primarySession, known });
      else if (path.basename(f) === 'events.jsonl') parseEvents(f, sink, allow);
      else parseManifest(f, sink, allow);
    }
    for (const [f, offs] of sink.lineIndex) data.lineIndex.set(f, offs);
    const { events } = finalize(sink, this.cfg, allow, false), fresh = new Set(events.map(e => e.id));
    // a re-parsed file replaces its own earlier events: one that is gone (e.g. a spawn whose target was not yet known) is removed
    const removes = data.events.filter(e => fileSet.has(e.source) && !fresh.has(e.id)).map(e => e.id);
    this.merge(events, removes, sink.actors);
  }
  full() {
    const prev = this.get(), next = collect(this.cfg), ids = new Set(next.events.map(e => e.id));
    const removes = prev.events.filter(e => !ids.has(e.id)).map(e => e.id);
    this.lastFull = Date.now(); this.set(next);
    const changed = next.events.filter(e => { const p = prev.byId.get(e.id); return !p || !same(p, e); });
    this.broadcast(changed, removes, [...next.actors.values()].filter(a => JSON.stringify(a) !== JSON.stringify(prev.actors.get(a.id))));
  }
  // Room's ID-only live notices (optional; off unless OFFICE_ROOM_FEED is set). A turn notice becomes a server `turn`.
  notice(n: { kind?: string; id?: string; branch?: string; at?: string }) {
    if (n.kind !== 'turns' || !n.id || !/^[\w-]{1,128}$/.test(n.id)) return;
    const data = this.get(), op = data.events.find(e => e.verb === 'write' && e.target?.kind === 'branch' && e.target.id === n.branch)?.operation;
    const sink = new Sink(); for (const [k, a] of data.actors) sink.actors.set(k, { ...a });
    sink.push({ ts: new Date(n.at && Number.isFinite(Date.parse(n.at)) ? n.at : Date.now()).toISOString(), actor: sink.ref('server'), verb: 'turn', target: { kind: 'turn', id: n.id, group: 'rooms' },
      ...(op ? { operation: op, opInferred: true } : {}), detailRef: { kind: 'room-notice', file: 'room-feed', lines: [], key: n.id }, source: 'room-feed', provenance: 'captured', tsSource: 'record', label: 'turn (live)' });
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
