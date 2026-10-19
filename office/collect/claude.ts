import fs from 'node:fs';
import path from 'node:path';
import { Sink, type OfficeEvent, type Target, type Verb, type Provenance } from './types';
import { shellFacts } from './shell';
import type { Allowlist } from './privacy';
import { UUID, roleFromTitle, roleActorId, sessionActorId, type Identity } from './roles';

export function readLines(file: string, sink: Sink) {
  const buf = fs.readFileSync(file), lines: string[] = [], offs: number[] = []; let start = 0;
  for (let i = 0; i <= buf.length; i++) if (i === buf.length || buf[i] === 10) { if (i > start || i < buf.length) { offs.push(start); lines.push(buf.toString('utf8', start, i)); } start = i + 1; }
  sink.lineIndex.set(file, offs); return lines;
}
const textOf = (c: any): string => typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => b?.type === 'text' ? b.text : '').join('\n') : '';
export const agentKind = (d = '') => /label/i.test(d) ? 'labeler' : /review|critic|audit|check|verify/i.test(d) ? 'reviewer' : /writ|draft|summar|report|research|commission/i.test(d) ? 'writer' : 'engineer';
const MUTE = new Set(['ToolSearch', 'ListAgents', 'Skill', 'TaskStop', 'TaskOutput', 'TodoWrite', 'Monitor', 'mcp__ccd_session__mark_chapter']);

interface Pending { events: OfficeEvent[]; ts: string; name: string }
export interface ClaudeOpts { file: string; actorId: string; session: boolean; primary: boolean; sessionId?: string; ident?: Identity }

// One transcript (session or sub-agent). Tool calls become events; results complete them (outcome, ms, result line).
export function parseClaude(o: ClaudeOpts, sink: Sink, allow: Allowlist) {
  const lines = readLines(o.file, sink), home = allow.cfg.home, pending = new Map<string, Pending>(), bg = new Map<string, OfficeEvent[]>();
  const stat: { kind: string; path: string; records: number; events: number; unparsed: number; dupes?: number; note?: string } = { kind: o.session ? 'claude-session' : 'claude-subagent', path: o.file, records: 0, events: 0, unparsed: 0 };
  let think = -1, lastText = -1, lastTs = '', firstTs = '', lastErr = false; const usage = new Map<string, number>();
  let me = o.actorId, title = '', lastSeen = '', early = false; const src = o.file, sid = o.sessionId, ident = o.session && sid ? o.ident : undefined;
  const ev = (e: { ts: string; verb: Verb; target?: Target; line: number[]; kind: string; provenance?: Provenance; key?: string; label?: string; hints?: string[]; actor?: string; extra?: any }) => {
    const x = sink.push({ ts: e.ts, actor: sink.ref(e.actor || me), verb: e.verb, target: e.target, detailRef: { kind: e.kind, file: src, lines: e.line, ...(e.key ? { key: e.key } : {}), ...(e.extra ? { extra: e.extra } : {}) },
      source: src, provenance: e.provenance || 'captured', tsSource: 'record', ...(e.label ? { label: e.label } : {}), ...(e.hints?.length ? { hints: e.hints } : {}) });
    stat.events++; if (o.session && !e.actor) sink.coordinatorCalls.push(x); return x;
  };
  const file = (p: string, cwd?: string): Target => { const c = allow.canonical(p, cwd); return { kind: 'file', id: c, path: c }; };
  lines.forEach((l, i) => {
    if (!l.trim()) return; let r: any; try { r = JSON.parse(l); } catch { stat.unparsed++; return; }
    if (o.session && (r.type === 'custom-title' || r.type === 'agent-name')) { const t = String(r.customTitle ?? r.agentName ?? ''); if (r.type === 'custom-title' || !title) title = t; if (sid) ident?.title(sid, t, lastSeen);
      const role = roleFromTitle(t), un = sid && sessionActorId(sid);
      if (ident && role && un && !early && firstTs && Date.parse(lastSeen) - Date.parse(firstTs) <= 15 * 60e3) { early = true; ident.setEarly(sid!, role, lastSeen, firstTs); const to = roleActorId(role);
        for (const e of sink.events) { if (e.source !== src) continue; if (e.actor.id === un) e.actor = { ...e.actor, id: to }; if (e.target?.kind === 'actor' && e.target.id === un) e.target = { ...e.target, id: to }; } } }
    // a fork or resume copies its parent's records (same uuid): they belong to the session that wrote them first
    if (o.session && typeof r.uuid === 'string') { if (sink.seenRecords.has(r.uuid)) { stat.dupes = (stat.dupes || 0) + 1; return; } sink.seenRecords.add(r.uuid); }
    const ts = r.timestamp; if (ts && !Number.isFinite(Date.parse(ts))) { stat.unparsed++; return; } stat.records++; if (!ts) return; if (!firstTs) firstTs = ts; const m = r.message;
    lastSeen = ts; if (ident) me = ident.actorAt(sid!, ts, title);
    if (r.type === 'assistant' && m && Array.isArray(m.content)) {
      lastTs = ts; const u = m.usage; if (m.id) usage.set(m.id, Math.max(usage.get(m.id) || 0, u ? (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0) : 0));
      lastErr = !!r.isApiErrorMessage || !!r.error;
      for (const b of m.content) {
        if (b.type === 'thinking') { if (b.thinking) think = i; continue; }
        if (b.type === 'text') { lastText = i; if (o.session && b.text?.trim()) ev({ ts, verb: 'message', target: { kind: 'actor', id: 'deniz' }, line: [i], kind: 'claude-text', key: String(m.content.indexOf(b)) }); continue; }
        if (b.type !== 'tool_use' || MUTE.has(b.name)) continue;
        const inp = b.input || {}, cwd = r.cwd, made: OfficeEvent[] = [], base = { ts, line: [i], key: b.id, kind: 'claude-tool', extra: think >= 0 ? { think } : undefined };
        if (b.name === 'Read' || b.name === 'NotebookRead') made.push(ev({ ...base, verb: 'read', target: file(inp.file_path || inp.notebook_path || '', cwd) }));
        else if (['Write', 'Edit', 'NotebookEdit', 'MultiEdit'].includes(b.name)) made.push(ev({ ...base, verb: 'write', target: file(inp.file_path || inp.notebook_path || '', cwd) }));
        else if (b.name === 'Glob' || b.name === 'Grep') made.push(ev({ ...base, verb: 'read', target: file(inp.path || cwd || '.', cwd), provenance: 'derived' }));
        else if (b.name === 'Agent' || b.name === 'Task') made.push(ev({ ...base, verb: 'spawn', target: { kind: 'actor', id: 'tool:' + b.id }, label: inp.description }));
        else if (b.name === 'SendMessage' && /^a[0-9a-f]{10,}$/.test(inp.to || '')) made.push(ev({ ...base, verb: 'message', target: { kind: 'actor', id: 'agent:' + inp.to } }));
        else if (b.name === 'SendMessage') { // to another session: resolved after every transcript is read (index.ts linkPeers)
          const x = ev({ ...base, verb: 'message', target: { kind: 'actor', id: 'peer:?' }, label: 'peer', extra: { ...base.extra, to: String(inp.to || inp.recipient || '').slice(0, 200), session: sid } }); made.push(x); sink.peerSends.push(x); }
        else if (b.name === 'AskUserQuestion') made.push(ev({ ...base, verb: 'message', target: { kind: 'actor', id: 'deniz' }, label: 'question' }));
        else if (b.name === 'Workflow') made.push(ev({ ...base, verb: 'dispatch', target: { kind: 'workflow', id: b.id }, label: 'workflow' }));
        else if (b.name === 'Bash') {
          const cmd = String(inp.command || ''), f = shellFacts(cmd, cwd || home, home);
          for (const p of f.reads) made.push(ev({ ...base, verb: 'read', target: file(p), provenance: 'derived' }));
          for (const p of f.writes) made.push(ev({ ...base, verb: 'write', target: file(p), provenance: 'derived' }));
          const toServer = /127\.0\.0\.1:4317|localhost:4317|driver\.mjs/.test(cmd), codex = /\bcodex\s+exec\b|codexlabel/.test(cmd);
          if (!made.length || toServer || codex) made.push(ev({ ...base, verb: 'dispatch', target: codex ? { kind: 'actor', id: 'providers' } : toServer ? { kind: 'actor', id: 'server' } : { kind: 'command', id: b.id } })); // no description: agent-written text stays out of labels
          made.forEach(e => e.hints = [...f.reads, ...f.writes, f.cwd, cmd.slice(0, 4000)]);
        } else made.push(ev({ ...base, verb: 'dispatch', target: { kind: 'tool', id: b.name }, label: b.name }));
        if (made[0].target?.kind === 'file' && !made[0].hints) made[0].hints = [made[0].target.path!];
        if (b.name === 'Agent' || b.name === 'Task') made[0].hints = [String(inp.prompt || '').slice(0, 4000)];
        if (b.name === 'SendMessage') made[0].hints = [String(inp.message || '').slice(0, 4000)];
        sink.toolOwner.set(b.id, made[0]);
        pending.set(b.id, { events: made, ts, name: b.name });
      }
      return;
    }
    if (r.type === 'user' && m) { think = -1;
      const blocks = Array.isArray(m.content) ? m.content : [];
      for (const b of blocks) {
        if (b.type !== 'tool_result') continue;
        const p = pending.get(b.tool_use_id); if (!p) continue; pending.delete(b.tool_use_id);
        const tr = r.toolUseResult || {}, txt = textOf(b.content), err = !!b.is_error || /^Exit code [1-9]/.test(txt);
        for (const e of p.events) { e.detailRef.lines.push(i); e.cost = { ms: Date.parse(ts) - Date.parse(p.ts) }; e.outcome = err ? 'error' : 'ok'; }
        if (p.name === 'Agent' || p.name === 'Task') {
          const id = tr.agentId || (txt.match(/agentId: (a[0-9a-f]+)/) || [])[1];
          if (id) { const s = p.events[0]; s.target = { kind: 'actor', id: 'agent:' + id }; sink.agentSpawn.set(id, s); s.outcome = tr.status === 'async_launched' ? 'launched' : err ? 'error' : 'returned'; }
        }
        if (tr.backgroundTaskId) { bg.set(tr.backgroundTaskId, p.events); p.events.forEach(e => e.outcome = 'background'); }
        if (p.name === 'SendMessage' && p.events[0].label === 'peer') { const x = p.events[0]; if (tr.success === false) x.outcome = 'error'; else if (UUID.test(String(tr.msg_id || ''))) x.detailRef.extra = { ...x.detailRef.extra, msgId: String(tr.msg_id).toLowerCase() }; }
      }
      // a message from another Claude session (Claude Desktop cross-session delivery, isMeta): not Deniz. Linked to its send in index.ts.
      if (o.session && r.origin?.kind === 'peer') { const g = r.origin; if (sid) sink.peerDeliveries.push({ msgId: UUID.test(String(g.msg_id || '')) ? String(g.msg_id).toLowerCase() : '', from: /^uds:\/[\w./-]{1,200}\.sock$/.test(String(g.from || '')) ? String(g.from) : '', name: String(g.name || '').slice(0, 200), ts, receiver: me, session: sid, file: src, line: i, body: String(g.body || '').slice(0, 4000) }); return; }
      if (r.isMeta || r.isCompactSummary || !o.session) return;
      const s = typeof m.content === 'string' ? m.content : blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      if (!s.trim()) return;
      const tn = s.match(/<task-notification>[\s\S]*?<task-id>([^<]+)<\/task-id>/);
      if (tn) {
        const id = tn[1], status = (s.match(/<status>([^<]+)<\/status>/) || [])[1];
        if (sink.agentSpawn.has(id) || /^a[0-9a-f]{10,}$/.test(id)) ev({ ts, verb: 'message', actor: 'agent:' + id, target: { kind: 'actor', id: me }, line: [i], kind: 'claude-notification', label: 'result: ' + (status || '?') });
        else for (const e of bg.get(id) || []) { e.until = ts; e.outcome = status === 'completed' ? 'ok' : status || 'done'; e.detailRef.lines.push(i); }
        return;
      }
      if (/^\s*<(command-|local-command|system-reminder|bash-)/.test(s)) return;
      ev({ ts, verb: 'message', actor: 'deniz', target: { kind: 'actor', id: me }, line: [i], kind: 'claude-user', label: /^\[Request interrupted/.test(s) ? 'interrupted' : undefined });
    }
  });
  if (stat.dupes) stat.note = `${stat.dupes} records repeat an earlier session's (a fork or resume): counted once, in the session that wrote them first`;
  sink.sources.push(stat);
  return { firstTs, lastTs, lastText, calls: usage.size, tokens: [...usage.values()].reduce((a, b) => a + b, 0), lastErr, lines: lines.length };
}

// Sub-agents: each transcript is an ephemeral actor, linked to the spawning Agent tool_use through meta.toolUseId.
export function parseSubagents(dir: string, sink: Sink, allow: Allowlist, parentAt?: (ts: string) => string) {
  const files: string[] = [];
  const walk = (d: string) => { for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n), st = fs.lstatSync(p); if (st.isDirectory()) walk(p); else if (st.isFile() && /^agent-.*\.jsonl$/.test(n)) files.push(p); } };
  if (fs.existsSync(dir)) walk(dir);
  const first = (f: string) => { const fd = fs.openSync(f, 'r'), b = Buffer.alloc(4096); const n = fs.readSync(fd, b, 0, 4096, 0); fs.closeSync(fd); return (b.toString('utf8', 0, n).match(/"timestamp":\s*"([^"]+)"/) || [])[1] || ''; };
  const order = files.map(f => ({ f, t: first(f) })).sort((a, b) => a.t.localeCompare(b.t) || a.f.localeCompare(b.f));
  for (const { f, t } of order) {
    const id = path.basename(f).replace(/^agent-|\.jsonl$/g, ''), metaF = f.replace(/\.jsonl$/, '.meta.json');
    let meta: any = {}; try { meta = JSON.parse(fs.readFileSync(metaF, 'utf8')); } catch {}
    const spawn = sink.agentSpawn.get(id) || (meta.toolUseId ? sink.toolOwner.get(meta.toolUseId) : undefined);
    const wf = /\/workflows\/([^/]+)\//.exec(f)?.[1];
    const parent = spawn ? spawn.actor.id : (t && parentAt?.(t)) || 'coordinator', actorId = 'agent:' + id;
    sink.actor({ id: actorId, kind: agentKind(meta.description), label: meta.description || 'agent ' + id.slice(0, 7), parent, parentInferred: !spawn, source: f });
    const res = parseClaude({ file: f, actorId, session: false, primary: false }, sink, allow);
    if (!res.firstTs) continue;
    if (spawn) { spawn.target = { kind: 'actor', id: actorId }; spawn.detailRef.extra = { ...(spawn.detailRef.extra || {}), agentFile: f }; }
    else sink.push({ ts: res.firstTs, actor: sink.ref(parent), verb: 'spawn', target: { kind: 'actor', id: actorId }, detailRef: { kind: 'claude-subagent-start', file: f, lines: [0], extra: { workflow: wf } },
      source: f, provenance: 'inferred', tsSource: 'record', label: meta.description });
    sink.push({ ts: res.lastTs || res.firstTs, actor: sink.ref(actorId), verb: 'end', target: { kind: 'actor', id: parent }, detailRef: { kind: 'claude-subagent-end', file: f, lines: res.lastText >= 0 ? [res.lastText] : [] },
      source: f, provenance: 'captured', tsSource: 'record', outcome: res.lastErr ? 'error' : res.lastText >= 0 ? 'done' : 'no-output', cost: { calls: res.calls, tokens: res.tokens } });
  }
}
