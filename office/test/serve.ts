import type { AddressInfo } from 'node:net';
import type { Config } from '../collect/privacy';
import { createOffice } from '../server';
export async function serve(cfg: Config) {
  const { app } = createOffice(cfg); const srv = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve, reject) => { srv.once('listening', resolve); srv.once('error', reject); });
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return { base, close: () => new Promise(r => srv.close(r)), get: async (u: string) => { const r = await fetch(base + u); return { status: r.status, text: await r.text() }; } };
}
