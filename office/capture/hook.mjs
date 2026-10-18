// Hook entry point. Plain JavaScript with no imports beyond Node built-ins, so even a failure to load the TypeScript
// (syntax, missing file, old Node) is counted in errors.count instead of being lost. Always exits 0, prints nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const E = process.env, dir = E.OFFICE_SPOOL || path.join(E.OFFICE_ROOM || path.join(E.OFFICE_HOME || os.homedir(), 'dev/room'), 'office-spool');
try { const m = await import('./hook-main.ts'); await m.run(); }
catch (e) { try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.appendFileSync(path.join(dir, 'errors.count'), `${new Date().toISOString()}\thook-load\t${e?.code || e?.name || 'Error'}\n`, { mode: 0o600 }); } catch {} }
process.exitCode = 0;
