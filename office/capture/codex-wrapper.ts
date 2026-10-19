// office-codex: `codex exec --json` with the caller contract of a plain call.
//   stdout  = the final agent message only (codex's --output-last-message)
//   stderr  = codex's own stderr, untouched
//   exit    = codex's exit code; if codex dies by a signal, the wrapper dies by the same signal
//   stdin, argv (incl. --output-schema) are forwarded as given; `office-codex resume <id> …` = `codex exec resume <id> …`
// The JSONL event stream goes only to the spool, sanitized and redacted before it is written. A spool failure never
// changes what the caller sees.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { codexRecord, codexCwd, forwardSignal, append, countError, spoolDir, Allowlist, config, clip } from './sanitize.ts';

const cfg = config(), dir = spoolDir(cfg), bin = process.env.OFFICE_CODEX_BIN || 'codex';
const args = process.argv.slice(2), resume = args[0] === 'resume', rest = (resume ? args.slice(1) : args).filter(a => a !== '--json');
const oi = rest.findIndex(a => a === '-o' || a === '--output-last-message'), oeq = rest.find(a => a.startsWith('--output-last-message='));
const tmp = oi < 0 && !oeq ? fs.mkdtempSync(path.join(os.tmpdir(), 'office-codex-')) : '';
const outFile = oi >= 0 ? rest[oi + 1] : oeq ? oeq.split('=').slice(1).join('=') : path.join(tmp, 'last-message.txt');
const where = codexCwd(rest, process.cwd()), cwd = where.cwd; // null: undetermined, every command output of this run is withheld
const codexArgs = ['exec', ...(resume ? ['resume'] : []), '--json', ...(tmp ? ['-o', outFile] : []), ...rest];
const run = crypto.randomUUID(), meta = { role: process.env.OFFICE_CODEX_ROLE || undefined, label: process.env.OFFICE_CODEX_LABEL || undefined, operation: process.env.OFFICE_OPERATION || undefined, caller: /^[0-9a-f-]{36}$/i.test(process.env.CLAUDE_CODE_SESSION_ID || '') ? process.env.CLAUDE_CODE_SESSION_ID : undefined, cwd: cwd || undefined, ...(cwd ? {} : { cwdUnknown: where.reason }) };
let allow: Allowlist | null = null; try { allow = new Allowlist(cfg); } catch (e) { countError(dir, 'codex', e); }
let seq = 0;
const spool = (make: () => object | null) => { try { const r = allow && make(); if (r) append(dir, 'codex', [r]); } catch (e) { countError(dir, 'codex', e); } };
const piped = !process.stdin.isTTY;
let prompt = '';
spool(() => ({ v: 1, src: 'codex', ts: new Date().toISOString(), run, seq: seq++, kind: 'start', resume, ...meta, id: run + ':start',
  args: rest.map(a => a.length > 300 ? a.slice(0, 300) + '…' : a) }));

const child = spawn(bin, codexArgs, { stdio: [piped ? 'pipe' : 'inherit', 'pipe', 'inherit'] });
if (piped) {
  process.stdin.on('data', (b: Buffer) => { if (prompt.length < 64_000) prompt += b.toString('utf8'); child.stdin!.write(b); });
  process.stdin.on('end', () => { child.stdin!.end(); spool(() => ({ v: 1, src: 'codex', ts: new Date().toISOString(), run, seq: seq++, kind: 'prompt', id: run + ':prompt', sections: [{ title: 'prompt', ...clip(prompt) }] })); });
  child.stdin!.on('error', () => {}); // codex may exit before reading all of stdin
}
let buf = '';
child.stdout!.on('data', (b: Buffer) => {
  buf += b.toString('utf8'); let i;
  while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) onLine(line); }
});
function onLine(line: string) {
  let ev: any; try { ev = JSON.parse(line); } catch { countError(dir, 'codex', { name: 'UnparsedStdout' }); return; }
  const n = seq++; spool(() => codexRecord(ev, run, n, allow!, cwd, meta));
}
const SIGS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'];
const interactive = !!process.stdin.isTTY;
for (const s of SIGS) process.on(s, () => { if (forwardSignal(s, interactive)) try { child.kill(s); } catch {} });
child.on('error', (e: any) => { process.stderr.write(`office-codex: cannot run ${bin}: ${e.message}\n`); finish(127, null); });
child.on('close', (code, signal) => { if (buf.trim()) onLine(buf); finish(code, signal); });
let done = false;
function finish(code: number | null, signal: NodeJS.Signals | null) {
  if (done) return; done = true;
  let final = ''; try { final = fs.readFileSync(outFile, 'utf8'); } catch {}
  if (final) { try { fs.writeSync(1, final); } catch {} }
  spool(() => ({ v: 1, src: 'codex', ts: new Date().toISOString(), run, seq: seq++, kind: 'end', id: run + ':end', exit: { code, signal }, ...meta, sections: final ? [{ title: 'final message', prose: true, ...clip(final) }] : [] }));
  if (tmp) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  if (signal) { for (const s of SIGS) process.removeAllListeners(s); process.kill(process.pid, signal); setTimeout(() => process.exit(128 + (os.constants.signals[signal] || 1)), 200); }
  else process.exit(code ?? 1);
}
