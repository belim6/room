import fs from 'node:fs';
import path from 'node:path';
import type { Actor, OfficeEvent } from './types';
import type { Allowlist } from './privacy';

// Human names for operations and agents, built from metadata only (ids, paths, spawn descriptions). Never unmasks a
// blind transcript id (no restricted/key.json lookup): a labeler is named by the T-id it was given.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;
const phase = (p = '') => p === 'labeling' ? 'labeling' : p.startsWith('run-') ? `${p.slice(4) === 'compare' || p.slice(4) === 'comparison' ? 'comparison' : p.slice(4)} run` : p;
export function opShort(id = '') {
  const [d, sub, ph] = id.split('/');
  if (!/^\d{4}-\d\d-\d\d$/.test(d || '')) return id;
  return [sub, phase(ph)].filter(Boolean).join(' ') || 'coordination';
}
export function opTitle(id: string, allow?: Allowlist) {
  const [d, sub, ph] = id.split('/');
  if (!/^\d{4}-\d\d-\d\d$/.test(d || '')) return { title: id.replace(/[-_]/g, ' ').replace(/\bo(\d)\b/i, 'O$1').replace(/^./, c => c.toUpperCase()), packet: undefined as string | undefined };
  const when = `${Number(d.slice(8))} ${MON[Number(d.slice(5, 7)) - 1]}`;
  let packet: string | undefined;
  if (allow && sub) { // the lowest-numbered packet in that day's folder that names the sub-operation
    try {
      const dir = path.join(allow.roots.coordination, d), f = fs.readdirSync(dir).filter(n => /^\d\d[a-z]?-.*\.md$/.test(n) && n.includes(sub)).sort()[0];
      if (f) { const r = allow.read(path.join(dir, f), undefined, 4000); packet = r.content?.match(/^#\s+(.+)$/m)?.[1]?.trim().slice(0, 120); }
    } catch {}
  }
  return { title: sub ? `${cap(sub)}${ph ? ' · ' + phase(ph) : ''} · ${when}` : `Coordination · ${when}`, packet };
}
const VERB = /^(label|review|build|write|draft|fix|run|check|verify|research|implement|investigate|inspect|summari[sz]e|audit)\s+/i;
export function displayName(a: Actor, ev: OfficeEvent[]) {
  if (a.permanent) return a.label;
  if (a.id.startsWith('session:')) return 'Claude session ' + a.id.slice(8);
  const fam = a.id.startsWith('agent:') ? 'Claude' : /^(codex|codexrun|critic):/.test(a.id) ? 'Codex' : a.id.startsWith('driver:') ? '' : a.id.startsWith('session:') ? 'Claude session' : '';
  const kind = a.kind === 'unknown' ? 'agent' : a.kind;
  let subject = a.label || '';
  if (a.id.startsWith('codex:')) subject = path.basename(a.id).replace(/#\d+$/, '');
  else if (a.id.startsWith('critic:')) subject = a.id.slice(7).replace(/^critic-\d{4}-\d\d-\d\d-?/, '').replace(/\.failed-quota|\.raw|#\d+/g, '').replace(/-/g, ' ');
  else if (a.id.startsWith('driver:')) subject = '';
  else subject = subject.replace(VERB, '').replace(/^(codex|claude)\s+(labeler|critic)\s+/i, '');
  const t = subject.match(/\bT-[0-9a-f]{8}\b/)?.[0]; if (t && subject.length > 24) subject = t;
  const op = opShort(a.operation || ev.find(e => e.operation)?.operation);
  const parts = [kind, fam, op && !subject.toLowerCase().includes(op.toLowerCase()) ? op : '', subject].filter(Boolean);
  return parts.join(' · ').replace(/\s+/g, ' ').slice(0, 90);
}

// A file's display name: its first markdown heading when the file is allowlisted .md (never under restricted/, never the
// unmasking key), else the file name in words. Blind ids stay as given: "T-3911f729" is never resolved to a room.
export function humanizeFile(p: string) {
  const b = path.basename(p).replace(/\.[A-Za-z0-9]+$/, '');
  return b.split(/(T-[0-9a-f]{8})/).map((part, i) => i % 2 ? part : part.replace(/[-_]+/g, ' ')).join('').replace(/\s+/g, ' ').trim() || path.basename(p);
}
export function fileTitle(p: string, allow: Allowlist, cache: Map<string, string>) {
  const hit = cache.get(p); if (hit != null) return hit;
  let t = '';
  if (/\.md$/i.test(p) && !/\/restricted\//i.test(p) && allow.allows(p)) { const r = allow.read(p, undefined, 4096); t = r.content?.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1]?.slice(0, 80) || ''; }
  t = t || humanizeFile(p); cache.set(p, t); return t;
}
