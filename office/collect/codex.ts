import fs from 'node:fs';
import path from 'node:path';
import { Sink, type OfficeEvent } from './types';
import { readLines } from './claude';
import { shellFacts } from './shell';
import type { Allowlist } from './privacy';

// Saved Codex CLI logs (stdout+stderr of `codex exec`). Everything parsed here is `derived` from text; times are not in the
// log, so ends come from file mtime and starts from the coordinator call that launched the run when one can be found.
const MARK = /^(user|codex|exec|thinking|tokens used|hook: .*|ERROR: .*|context compacted)$/;
export interface Section { kind: string; start: number; end: number; head?: string }
export interface CodexSession { header: Record<string, string>; start: number; end: number; sections: Section[] }
export function codexSessions(lines: string[]): { sessions: CodexSession[]; preamble: number } {
  const sessions: CodexSession[] = []; let cur: CodexSession | null = null, preamble = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^OpenAI Codex v/.test(l)) { if (cur) cur.end = i; cur = { header: { version: l.slice(13).trim() }, start: i, end: lines.length, sections: [] };
      let j = i + 1; if (lines[j] === '--------') j++; for (; j < lines.length && lines[j] !== '--------'; j++) { const m = lines[j].match(/^([a-z ]+): (.*)$/); if (m) cur.header[m[1]] = m[2]; } i = j; sessions.push(cur); continue; }
    if (!cur) { if (l.trim()) preamble++; continue; }
    if (MARK.test(l)) { const last = cur.sections[cur.sections.length - 1]; if (last) last.end = i; cur.sections.push({ kind: l.startsWith('hook:') ? 'hook' : l.startsWith('ERROR:') ? 'error' : l, start: i, end: lines.length, head: l }); }
  }
  for (const s of sessions) { const last = s.sections[s.sections.length - 1]; if (last) last.end = Math.min(last.end, s.end); }
  return { sessions, preamble };
}
// One `exec` section: the (possibly multi-line) command up to its status line, its cwd, and its output.
export function execOf(lines: string[], sec: Section) {
  let k = sec.start + 1; while (k < sec.end && !/^ (succeeded|exited|failed|declined)\b/.test(lines[k])) k++;
  const head = lines.slice(sec.start + 1, k).join('\n'), m = head.match(/^([\s\S]*) in (\/[^\n]*)$/), raw = m ? m[1] : head, cwd = m ? m[2] : '';
  const w = raw.match(/^\S*(?:zsh|bash|sh) -l?c '([\s\S]*)'$/) || raw.match(/^\S*(?:zsh|bash|sh) -l?c "([\s\S]*)"$/);
  return { raw, cwd, wrapped: !!w, inner: w ? w[1].replace(/'\\''/g, "'") : raw, status: lines[k] || '', output: lines.slice(k + 1, sec.end).join('\n'), fail: /^\s*(exited [1-9]|failed|declined)/.test(lines[k] || '') };
}
export function finalMessage(lines: string[], s: CodexSession) { const c = s.sections.filter(x => x.kind === 'codex').pop(); return c ? lines.slice(c.start + 1, c.end).join('\n').trim() : ''; }
export const parseTokens = (s: string) => { const n = Number(String(s).replace(/[.,\s]/g, '')); return Number.isFinite(n) ? n : undefined; };
export const findingsOf = (text: string) => (text.match(/^\s*(?:\d+\.|[-*]\s+\*\*P\d|\*\*P\d)/gm) || []).length;
export function verdictOf(text: string) {
  if (/\bNO[- ]GO\b/.test(text)) return 'no-go'; if (/\bconditional GO\b/i.test(text)) return 'conditional-go'; if (/\bGO\b/.test(text)) return 'go'; return undefined;
}
const jsonOk = (t: string) => { const i = t.indexOf('{'); if (i < 0) return false; try { JSON.parse(t.slice(i)); return true; } catch { return false; } };

export function parseCodexLog(file: string, role: 'labeler' | 'critic', sink: Sink, allow: Allowlist) {
  const lines = readLines(file, sink), { sessions, preamble } = codexSessions(lines), st = fs.statSync(file), mtime = st.mtime.toISOString();
  const stat = { kind: role === 'critic' ? 'codex-critic-log' : 'codex-labeler-log', path: file, records: sessions.length, events: 0, unparsed: sessions.length ? 0 : 1, note: preamble ? `${preamble} preamble lines (stdout) before the Codex header` : undefined };
  sink.sources.push(stat); if (!sessions.length) return;
  const base = path.basename(file).replace(/(\.raw)?\.log$/, ''), dir = path.dirname(file), home = allow.cfg.home;
  // Launch link: the latest coordinator call before mtime that names this log or (labelers) runs codex in this folder.
  const relDir = path.relative(path.dirname(allow.cfg.coordination), role === 'labeler' ? path.dirname(path.dirname(dir)) : dir);
  const launch = [...sink.coordinatorCalls].reverse().find(c => c.ts <= mtime && Date.parse(mtime) - Date.parse(c.ts) < 3 * 3600e3 &&
    (c.hints || []).some(h => h.includes(path.basename(file)) || (role === 'labeler' && /codex/.test(h) && h.includes(relDir.replace(/^coordination\//, '')))));
  const endTs = (launch?.until && launch.until < mtime ? launch.until : undefined) || mtime;
  sessions.forEach((s, k) => {
    const id = role === 'critic' ? `critic:${base}${sessions.length > 1 ? '#' + (k + 1) : ''}` : `codex:${path.relative(allow.cfg.coordination, dir)}/${base}${sessions.length > 1 ? '#' + (k + 1) : ''}`;
    sink.actor({ id, kind: role, label: role === 'critic' ? `critic ${base.replace(/^critic-/, '')}` : `codex labeler ${base}`, parent: role === 'critic' ? 'critic' : 'coordinator', parentInferred: !launch || role === 'critic', source: file });
    const parent = role === 'critic' ? 'critic' : 'coordinator';
    // Sessions in one file ran in order; spread them (and their steps) across [start, end]. Interpolated times are marked so.
    const t0 = launch ? Date.parse(launch.ts) : Date.parse(mtime) - 60e3 * sessions.length, t1 = Date.parse(endTs);
    const span = (t1 - t0) / sessions.length, s0 = t0 + span * k, steps = s.sections.length + 1;
    const at = (n: number) => new Date(Math.round(s0 + (span * n) / (steps + 1))).toISOString();
    const push = (e: Partial<OfficeEvent> & Pick<OfficeEvent, 'verb' | 'ts'>, ls: number[], kind: string) => { stat.events++; return sink.push({ actor: sink.ref(id), source: file, provenance: 'derived', tsSource: 'interpolated', detailRef: { kind, file, lines: ls }, ...e } as any); };
    push({ ts: at(0), verb: 'spawn', actor: sink.ref(parent), target: { kind: 'actor', id }, provenance: launch ? 'derived' : 'inferred', tsSource: launch ? 'linked' : 'interpolated', label: s.header.model,
      ...(launch ? { hints: launch.hints } : {}) } as any, [s.start], 'codex-session');
    if (launch) { const e = sink.events[sink.events.length - 1]; e.detailRef.extra = { launch: launch.id }; }
    s.sections.forEach((sec, n) => {
      if (sec.kind === 'exec') {
        const x = execOf(lines, sec), cwd = x.cwd || s.header.workdir || dir, fail = x.fail;
        const f = shellFacts(x.inner, cwd, home), hints = [...f.reads, ...f.writes, cwd, x.inner];
        const tg = [...f.reads.map(p => ['read', p]), ...f.writes.map(p => ['write', p])];
        if (!tg.length) push({ ts: at(n + 1), verb: 'dispatch', target: { kind: 'command', id: `${id}:${sec.start}` }, outcome: fail ? 'error' : 'ok', hints } as any, [sec.start, sec.end], 'codex-exec');
        for (const [v, p] of tg) push({ ts: at(n + 1), verb: v as any, target: { kind: 'file', id: allow.canonical(p), path: allow.canonical(p) }, outcome: fail ? 'error' : 'ok', hints } as any, [sec.start, sec.end], 'codex-exec');
      } else if (sec.kind === 'error') push({ ts: at(n + 1), verb: 'error', target: { kind: 'actor', id: 'providers' }, outcome: 'error', label: 'Codex error' }, [sec.start, sec.end], 'codex-section');
    });
    const fin = finalMessage(lines, s), tokSec = s.sections.find(x => x.kind === 'tokens used'), errs = s.sections.some(x => x.kind === 'error');
    const lastCodex = s.sections.filter(x => x.kind === 'codex').pop(), errAfter = s.sections.some(x => x.kind === 'error' && (!lastCodex || x.start > lastCodex.start));
    const outcome = errAfter || (errs && !fin) ? 'error' : role === 'critic' ? (verdictOf(fin) || (fin ? 'done' : 'no-output')) : (fin && jsonOk(fin) ? 'verdict' : !fin ? 'no-output' : fs.existsSync(path.join(dir, base + '.json')) ? 'extraction-failed-repaired' : 'extraction-failed');
    const finSec = s.sections.filter(x => x.kind === 'codex').pop();
    push({ ts: k === sessions.length - 1 ? endTs : at(steps), tsSource: k === sessions.length - 1 ? 'mtime' : 'interpolated', verb: 'end', target: { kind: 'actor', id: parent }, outcome,
      cost: { calls: 1, tokens: tokSec ? parseTokens(lines[tokSec.start + 1]) : undefined }, ...(role === 'critic' && findingsOf(fin) ? { findings: findingsOf(fin) } : {}) } as any, finSec ? [finSec.start, finSec.end] : [], 'codex-final');
  });
}
