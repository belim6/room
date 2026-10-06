// npm run backup [-- --offline-confirmed]   ·   npm run backup:verify-restore -- <backup directory>
// Defaults match the stable launchd service; override with ROOM_DATA_DIR, ROOM_BACKUP_DIR, ROOM_PORT,
// ROOM_SERVICE_LABEL, ROOM_SERVICE_PLIST, ROOM_APP_DIR. ROOM_SERVICE_LABEL=none skips service control (scratch instances).
import os from 'node:os';
import path from 'node:path';
import { backup, verifyRestore, launchdService, type ServiceControl } from '../src/workbench/backup';
const home = os.homedir(), args = process.argv.slice(2), log = (line: string) => console.log(line);
const appDir = process.env.ROOM_APP_DIR || process.cwd();
async function main() {
  if (args[0] === 'verify-restore') {
    const target = args[1];
    if (!target) throw Error('Usage: npm run backup:verify-restore -- <backup directory>');
    const result = await verifyRestore({ backup: path.resolve(target), repoDir: appDir, appDir: process.env.ROOM_VERIFY_APP_DIR, log, keep: args.includes('--keep') });
    console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1; return;
  }
  const label = process.env.ROOM_SERVICE_LABEL || 'com.deniz.room';
  const service: ServiceControl = label === 'none' ? { async stop() {}, async start() {} }
    : launchdService(label, process.env.ROOM_SERVICE_PLIST || path.join(home, 'Library/LaunchAgents', label + '.plist'));
  const options = { dataDir: path.resolve(process.env.ROOM_DATA_DIR || path.join(home, 'dev/room/.room-data')), backupRoot: path.resolve(process.env.ROOM_BACKUP_DIR || path.join(home, 'dev/room-backups')),
    apiBase: `http://127.0.0.1:${process.env.ROOM_PORT || 4317}`, service, appDir, offlineConfirmed: args.includes('--offline-confirmed'), log };
  log(`Data: ${options.dataDir}\nBackups: ${options.backupRoot}\nAPI: ${options.apiBase}\nService: ${label}\nApp: ${appDir}`);
  const result = await backup(options);
  console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1;
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
