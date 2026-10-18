// Claude Code observation hook (configure as async): stdin JSON -> one sanitized spool line. Never blocks the tool, never
// prints, always exits 0; failures go to the spool's errors.count. No network.
import fs from 'node:fs';
import { hookRecord, append, countError, spoolDir, Allowlist, config } from './sanitize.ts';

const cfg = config(), dir = spoolDir(cfg);
try {
  const h = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const rec = hookRecord(h, new Allowlist(cfg));
  append(dir, 'hooks', [rec], rec.ts);
} catch (e) { countError(dir, 'hook', e); }
process.exitCode = 0;
