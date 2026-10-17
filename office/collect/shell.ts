import path from 'node:path';

// Best-effort reading of a shell command line: which files it reads or writes. Everything here is derived from text.
export const READ_CMDS = new Set(['cat', 'sed', 'head', 'tail', 'less', 'more', 'nl', 'wc', 'grep', 'egrep', 'rg', 'awk', 'jq', 'cut', 'sort', 'uniq', 'diff', 'tac', 'strings', 'xxd', 'od', 'base64', 'shasum', 'sha256sum', 'md5', 'file', 'stat', 'cmp']);
const PATTERN_FIRST = new Set(['grep', 'egrep', 'rg', 'awk', 'jq']);
const ARGF: Record<string, string[]> = { head: ['-n', '-c'], tail: ['-n', '-c'], grep: ['-e', '-f', '-m', '-A', '-B', '-C'], egrep: ['-e', '-f', '-m', '-A', '-B', '-C'],
  rg: ['-e', '-f', '-m', '-A', '-B', '-C', '-g', '-t', '--glob', '--type'], sed: ['-e', '-f'], cut: ['-c', '-d', '-f', '-b'], awk: ['-f', '-F', '-v'], jq: ['--arg', '-f'], sort: ['-k', '-t'], nl: ['-w', '-s'], xxd: ['-l', '-s', '-c'], od: ['-N', '-j'] };
const WRITE_CMDS = new Set(['mv', 'cp', 'rm', 'touch', 'tee', 'ln']);
const FILEISH = /(^|\/)[^/\s]*\.(md|json|jsonl|log|mjs|js|ts|txt|html|css|csv|yaml|yml|py|sh|env|toml|plist)$|\//;

export function tokenize(s: string): string[] {
  const out: string[] = []; let cur = '', q: string | null = null, any = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"' && i + 1 < s.length) cur += s[++i]; else cur += c; continue; }
    if (c === "'" || c === '"') { q = c; any = true; continue; }
    if (c === '\\' && i + 1 < s.length) { cur += s[++i]; any = true; continue; }
    if (/\s/.test(c)) { if (cur || any) out.push(cur); cur = ''; any = false; continue; }
    if (c === '>' || c === '<') { if (cur || any) out.push(cur); cur = ''; any = false; let op = c; while (s[i + 1] === '>' || s[i + 1] === '<' || s[i + 1] === '&') op += s[++i]; out.push(op); continue; }
    cur += c;
  }
  if (cur || any) out.push(cur);
  return out;
}
// Strip heredoc bodies, then split on ; && || | and newlines (quotes respected).
export function segments(cmd: string): string[] {
  const lines = cmd.split('\n'), kept: string[] = []; let end: string | null = null;
  for (const l of lines) {
    if (end !== null) { if (l.trim() === end) end = null; continue; }
    const m = l.match(/<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/); kept.push(m ? l.slice(0, m.index) + ' ' + l.slice(m.index! + m[0].length) : l); if (m) end = m[1];
  }
  const s = kept.join('\n'), out: string[] = []; let cur = '', q: string | null = null, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === q) q = null; else if (c === '\\') cur += s[++i] ?? ''; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '(' || c === '{') depth++; if (c === ')' || c === '}') depth = Math.max(0, depth - 1);
    if (depth === 0 && (c === ';' || c === '\n' || c === '|' || (c === '&' && s[i + 1] === '&'))) { if (cur.trim()) out.push(cur.trim()); cur = ''; if (s[i + 1] === c) i++; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
export interface ShellFacts { reads: string[]; writes: string[]; cwd: string; commands: string[] }
export function shellFacts(cmd: string, cwd: string, home: string): ShellFacts {
  const reads: string[] = [], writes: string[] = [], commands: string[] = [];
  const abs = (p: string) => path.resolve(cwd, p === '~' ? home : p.startsWith('~/') ? path.join(home, p.slice(2)) : p);
  for (const seg of segments(cmd)) {
    const t = tokenize(seg); while (t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0])) t.shift();
    if (!t.length) continue;
    const name = path.basename(t[0]); commands.push(name);
    for (let i = 1; i < t.length; i++) if (/^>>?$|^&>>?$|^\d>>?$/.test(t[i]) && t[i + 1] && !/^\/dev\//.test(t[i + 1]) && !/^&|[$`()]/.test(t[i + 1])) writes.push(abs(t[i + 1]));
    if (name === 'cd' && t[1]) { cwd = abs(t[1]); continue; }
    const args: string[] = []; for (let i = 1; i < t.length; i++) { if (/^[<>&\d]*[<>]/.test(t[i])) { i++; continue; } args.push(t[i]); }
    if (READ_CMDS.has(name)) {
      let skip = PATTERN_FIRST.has(name) ? 1 : name === 'sed' ? 1 : 0; const files: string[] = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a.startsWith('-')) { if ((ARGF[name] || []).includes(a)) { i++; if ((a === '-e' || a === '-f') && name !== 'cut') skip = 0; } continue; }
        if (skip) { skip--; continue; }
        if (FILEISH.test(a) && !/[$`*?{]/.test(a)) files.push(abs(a));
      }
      if (name === 'sed' && args.includes('-i')) writes.push(...files); else reads.push(...files);
    } else if (WRITE_CMDS.has(name)) {
      const files = args.filter(a => !a.startsWith('-') && !/[$`*?{]/.test(a)).map(abs);
      if (name === 'cp') { reads.push(...files.slice(0, -1)); writes.push(...files.slice(-1)); }
      else if (name === 'mv') writes.push(...files); else writes.push(...files);
    }
  }
  return { reads: [...new Set(reads)], writes: [...new Set(writes)], cwd, commands };
}

// Fail-closed check before showing a command's output: every part of the command must be understood and every path it can
// touch must be allowlisted. Anything else (variables, substitutions, heredocs, globs, interpreters, unknown tools) is
// unverifiable and its output is withheld.
const SAFE = new Set(['cat', 'sed', 'head', 'tail', 'nl', 'wc', 'grep', 'egrep', 'rg', 'cut', 'sort', 'uniq', 'diff', 'ls', 'cd', 'jq', 'file', 'stat', 'echo', 'printf', 'pwd', 'tr', 'true', 'tac', 'cmp', 'shasum', 'sha256sum', 'md5', 'column']);
const PATTERN_AT: Record<string, number> = { grep: 1, egrep: 1, rg: 1, sed: 1, jq: 1, tr: 2, echo: 99, printf: 99 };
export function verifyCommand(cmd: string, cwd: string, home: string, okFile: (p: string) => boolean, okDir: (p: string) => boolean): { ok: boolean; reason?: string } {
  const no = (reason: string) => ({ ok: false, reason });
  if (/[$`]/.test(cmd)) return no('uses a variable or substitution');
  if (/<<|<\(|>\(/.test(cmd)) return no('uses a heredoc or process substitution');
  if (!okDir(cwd)) return no('working directory is off-allowlist: ' + cwd);
  const abs = (p: string) => path.resolve(cwd, p === '~' ? home : p.startsWith('~/') ? path.join(home, p.slice(2)) : p);
  for (const seg of segments(cmd)) {
    if (/^[({]|[)}]$/.test(seg)) return no('uses a subshell or group');
    const t = tokenize(seg); if (!t.length) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0])) return no('sets environment variables');
    const name = t[0];
    if (name.includes('/') || !SAFE.has(name)) return no('runs an unverifiable program: ' + name);
    if (name === 'cd' && (t.length !== 2 || /^[-~]/.test(t[1]))) return no('cd target is not a literal path');
    let pat = PATTERN_AT[name] || 0;
    for (let i = 1; i < t.length; i++) {
      const a = t[i];
      if (/^[<>&\d]*[<>]/.test(a)) continue; // redirection operator; its target is checked as the next token
      if (a.startsWith('-')) {
        if (a.includes('/') || a.includes('~')) return no('a flag names a path: ' + a);
        if (/^-[A-Za-z0-9]*[rRL]/.test(a) || /^--(recursive|follow|dereference|dereference-recursive)\b/.test(a)) return no('recursive or link-following flag: ' + a);
        continue;
      }
      if (pat > 0) { pat--; if (name === 'sed' && !/^[\d,$;!pnq\s]+$/.test(a)) return no('sed script is not a plain print'); continue; }
      if (/[*?[\]{}]/.test(a)) return no('uses a glob: ' + a);
      const p = abs(a); if (!okFile(p) && !okDir(p)) return no('touches an off-allowlist path: ' + p);
    }
    if (name === 'cd') cwd = abs(t[1]);
    if (!okDir(cwd)) return no('changes into an off-allowlist directory: ' + cwd);
  }
  return { ok: true };
}

// Does the command write somewhere we can't show? Then its text (the payload) is withheld, not just its output.
// Coarse on purpose: any write construct whose target isn't a resolved, allowlisted path counts.
const WRITE_CONSTRUCT = /(^|[^0-9&<>])>>?(?!&)\s*(?!\/dev\/null\b)\S|\btee\b|\bsed\b[^|;&\n]*\s-i\b|\b(cp|mv|ln|touch|rm)\s/;
export function offAllowlistWrites(cmd: string, cwd: string, home: string, okFile: (p: string) => boolean): { withhold: boolean; targets: string[] } {
  if (!WRITE_CONSTRUCT.test(cmd)) return { withhold: false, targets: [] };
  const f = shellFacts(cmd, cwd, home), off = f.writes.filter(p => !okFile(p));
  const unresolvable = !f.writes.length || /(>>?|\btee\b(\s+-a)?)\s*["']?[$`(]/.test(cmd);
  return { withhold: unresolvable || off.length > 0, targets: off.length ? off : unresolvable ? ['an unverifiable path'] : [] };
}
