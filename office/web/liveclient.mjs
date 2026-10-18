// Live connection with catch-up. Every `hello` from the server (first connect, the browser's automatic reconnect after a
// drop, or Live switched back on) triggers a refetch of the current operation, so nothing that happened while the client
// was off or disconnected is lost. Deltas arriving during the refetch are queued and applied after it (upserts and
// removals are idempotent). Shared by the page and the tests.
export function liveClient({ url = '/api/live', ES = globalThis.EventSource, refetch, onReset, onDelta }) {
  let src = null, pending = null, gen = 0;
  const hello = async () => {
    const my = ++gen; pending = [];
    let snap; try { snap = await refetch(); } catch { if (my === gen) pending = null; return; }
    if (my !== gen) return; // a newer hello (or a stop) superseded this catch-up
    onReset(snap); const q = pending; pending = null; for (const d of q) onDelta(d);
  };
  return {
    start() { if (src) return; src = new ES(url); src.addEventListener('hello', hello); src.addEventListener('events', (m) => { const d = JSON.parse(m.data); if (pending) pending.push(d); else onDelta(d); }); },
    stop() { src?.close(); src = null; gen++; pending = null; },
    get on() { return !!src; },
  };
}
