import type { AddressInfo } from 'node:net';
import type { Config } from '../collect/privacy';
import { createOffice } from '../server';
import type { ForkRunner } from '../fork';
export async function serve(cfg: Config, runner?: ForkRunner) {
  const office = createOffice(cfg, undefined, runner); const { app } = office; const srv = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve, reject) => { srv.once('listening', resolve); srv.once('error', reject); });
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return { base, close: () => new Promise(r => srv.close(r)), drainForks: office.drainForks, get: async (u: string) => { const r = await fetch(base + u); return { status: r.status, text: await r.text() }; } };
}
