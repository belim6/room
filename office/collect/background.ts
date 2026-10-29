import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { Collected } from './index';
import { Allowlist, type Config } from './privacy';
import { Identity } from './roles';
import { blindChecker, refreshBlind } from './rooms';

// Only plain data crosses the worker boundary. Reattach the two behavior-bearing objects locally.
export interface BackgroundOpts { timeoutMs?: number; createWorker?: (code: string, options: { eval: true; workerData: unknown }) => Pick<Worker, 'once' | 'terminate'> }
export function collectBackground(cfg: Config, opts: BackgroundOpts = {}): Promise<Collected> {
  const file = path.join(__dirname, 'index' + ( __filename.endsWith('.ts') ? '.ts' : '.js'));
  return new Promise((resolve, reject) => {
    const worker = (opts.createWorker || ((code, options) => new Worker(code, options)))(`
      const { parentPort, workerData } = require('node:worker_threads');
      if (workerData.file.endsWith('.ts')) require('tsx/cjs');
      const start = performance.now();
      const data = require(workerData.file).collect(workerData.cfg);
      const { allow, ident, ...plain } = data;
      parentPort.postMessage({ ...plain, ident: { ...ident } });
      console.info('[office timing] background collect', Math.round(performance.now()-start), 'ms');
    `, { eval: true, workerData: { cfg, file } });
    let settled = false;
    const finish = (error?: Error, data?: Collected) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { void worker.terminate().catch(() => {}); reject(error); }
      else resolve(data!);
    };
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const timer = setTimeout(() => finish(new Error(`Collector timed out after ${timeoutMs} ms`)), timeoutMs);
    worker.once('message', data => {
      if (settled) return;
      try {
        const allow = new Allowlist(cfg); allow.blind = blindChecker(allow); refreshBlind(allow);
        finish(undefined, { ...data, allow, ident: Object.assign(new Identity(), data.ident) });
      } catch (error) { finish(error as Error); }
    });
    worker.once('error', error => finish(error));
    worker.once('exit', code => finish(new Error(`Collector exited ${code} without a snapshot`)));
  });
}
