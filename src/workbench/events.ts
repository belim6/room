import type { Request, Response } from 'express';
import type { Store } from './store';
// Live notices: IDs only, never record content. The browser fetches anything it shows through the usual endpoints.
export interface Notice { kind: string; id: string; branch?: string; experiment?: string; at: string }
const ref = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v) ? v : undefined;
const OWNED: Record<string, string> = { outcomes: 'attempts', 'jev-results': 'jev-requests' };
const SELF_EXPERIMENT = new Set(['experiments', 'experiment-locks', 'experiment-revisions']);
export function noticeOf(store: Store, kind: string, key: string, value: any, owners = new Map<string, string>()): Notice {
  const v = kind === 'experiment-trial-events' ? value?.value : value;
  let branch = kind === 'branches' ? ref(key) : ref(v?.branch);
  // Outcomes and Jev results carry only their request's ID; the branch comes from the request, remembered or read once.
  const owner = OWNED[kind];
  if (owner && !branch) { branch = owners.get(key); owners.delete(key); if (!branch) try { branch = ref(store.get(owner, key).branch); } catch {} }
  if ((kind === 'attempts' || kind === 'jev-requests') && branch) { if (owners.size > 5000) owners.clear(); owners.set(key, branch); }
  const experiment = ref(v?.experiment) ?? (SELF_EXPERIMENT.has(kind) ? ref(v?.id) : undefined);
  return { kind, id: key, ...(branch ? { branch } : {}), ...(experiment ? { experiment } : {}), at: new Date().toISOString() };
}
// One store subscription while anyone listens; it is dropped with the last connection.
export function liveEvents(store: Store, heartbeatMs = 25000) {
  const clients = new Set<(n: Notice) => void>(), owners = new Map<string, string>();
  let off: (() => void) | null = null;
  const listener = (kind: string, key: string, value: unknown) => { const n = noticeOf(store, kind, key, value, owners); for (const send of clients) try { send(n); } catch {} };
  const handler = (_req: Request, res: Response) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': live\n\n');
    const send = (n: Notice) => { res.write(`data: ${JSON.stringify(n)}\n\n`); };
    clients.add(send); off ??= store.subscribe(listener);
    const beat = setInterval(() => res.write(': beat\n\n'), heartbeatMs); beat.unref();
    res.on('close', () => { clearInterval(beat); clients.delete(send); if (!clients.size && off) { off(); off = null; owners.clear(); } });
  };
  return { handler, clients };
}
