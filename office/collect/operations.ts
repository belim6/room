import fs from 'node:fs';
import pathModule from 'node:path';
import { Allowlist } from './privacy';
import type { OfficeEvent, OperationNode } from './types';
import { tokenRollup } from './token-usage';
import type { TokenUsage } from './types';
import { operationPlacement } from '../web/operation-placement.mjs';

type InputNode = Omit<OperationNode, 'eventCount' | 'unfiledEventCount' | 'gapCount'>;
export interface OperationTree { nodes: OperationNode[]; unattributed?: TokenUsage; error?: string }

/** Load a configured operation forest and compute metadata counts without changing source events. */
export function operationTree(file: string | undefined, allow: Allowlist, events: OfficeEvent[], unattributed?: TokenUsage): OperationTree | undefined {
  try { return loadTree(file, allow, events, unattributed); } catch (e: any) { return { nodes: [], error: String(e?.message || e) }; }
}
function loadTree(file: string | undefined, allow: Allowlist, events: OfficeEvent[], unattributed?: TokenUsage): OperationTree | undefined {
  if (!file) return undefined;
  const path = allow.canonical(file);
  const opened = allow.openVerified(path, p => allow.allows(p));
  if (opened === 'missing') return undefined;
  if (opened === 'refused') throw new Error(`Cannot safely read operations file: ${path}`);
  let text: string;
  try {
    if (opened.size > 1_000_000) throw new Error('operations file exceeds 1 MB');
    const buf = Buffer.alloc(opened.size); fs.readSync(opened.fd, buf, 0, buf.length, 0); text = buf.toString('utf8');
  } finally { fs.closeSync(opened.fd); }
  const raw = JSON.parse(text), rows = Array.isArray(raw) ? raw : raw?.nodes;
  if (!Array.isArray(rows)) throw new Error('operations.json must be an array or an object with a nodes array');
  const nodes: InputNode[] = rows.map((n: any, i: number) => {
    if (!n || typeof n !== 'object' || Array.isArray(n) || !str(n.id) || !str(n.title) || !(n.parent === null || str(n.parent)) ||
      !str(n.goal) || !str(n.status) || !str(n.owner) || !n.budget || typeof n.budget !== 'object' || Array.isArray(n.budget) ||
      (n.aliases !== undefined && (!Array.isArray(n.aliases) || !n.aliases.every(str)))) throw new Error(`invalid operation node at index ${i}`);
    return { id: n.id, title: n.title, parent: n.parent, goal: n.goal, status: n.status, owner: n.owner, budget: n.budget, ...(n.aliases ? { aliases: n.aliases } : {}), ...(n.close && typeof n.close === 'object' && !Array.isArray(n.close) ? { close: n.close } : {}) } as InputNode;
  });
  if (nodes.some(n => n.id === 'unfiled')) throw new Error("'unfiled' is a reserved operation id");
  const byId = new Map<string, InputNode>();
  for (const n of nodes) { if (byId.has(n.id)) throw new Error(`duplicate operation id: ${n.id}`); byId.set(n.id, n); }
  for (const n of nodes) if (n.parent !== null && !byId.has(n.parent)) throw new Error(`missing parent ${n.parent} for ${n.id}`);
  const visiting = new Set<string>(), done = new Set<string>();
  const visit = (id: string) => { if (visiting.has(id)) throw new Error(`operation cycle at ${id}`); if (done.has(id)) return; visiting.add(id); const p = byId.get(id)!.parent; if (p !== null) visit(p); visiting.delete(id); done.add(id); };
  for (const n of nodes) visit(n.id);
  const targets = new Map<string, string>();
  for (const n of nodes) for (const key of [n.id, ...(n.aliases || [])]) {
    if (targets.has(key)) throw new Error(`duplicate operation id or alias: ${key}`); targets.set(key, n.id);
  }
  const direct = new Map<string, { placed: number; unfiled: number; gaps: number }>();
  for (const n of nodes) direct.set(n.id, { placed: 0, unfiled: 0, gaps: 0 });
  const unfiled = { id: 'unfiled', title: 'Unfiled', parent: null, goal: '', status: 'unfiled', owner: '', budget: {}, eventCount: 0, unfiledEventCount: 0, gapCount: 0 } as OperationNode;
  for (const e of events) {
    const id = operationPlacement(e.operation, nodes) || undefined;
    if (!id) { unfiled.eventCount++; unfiled.unfiledEventCount++; if (e.gap) unfiled.gapCount++; continue; }
    const c = direct.get(id)!; c.placed++; if (e.gap) c.gaps++;
  }
  const children = new Map<string, InputNode[]>();
  for (const n of nodes) if (n.parent !== null) children.set(n.parent, [...(children.get(n.parent) || []), n]);
  const computed = new Map<string, { eventCount: number; gapCount: number }>();
  const totals = (id: string): { eventCount: number; gapCount: number } => {
    const own = direct.get(id)!; let eventCount = own.placed, gapCount = own.gaps;
    for (const child of children.get(id) || []) { const c = totals(child.id); eventCount += c.eventCount; gapCount += c.gapCount; }
    const result = { eventCount, gapCount }; computed.set(id, result); return result;
  };
  for (const n of nodes) if (n.parent === null) totals(n.id);
  const output = nodes.map(n => {
    const node: OperationNode = { ...n, eventCount: computed.get(n.id)!.eventCount, unfiledEventCount: 0, gapCount: computed.get(n.id)!.gapCount };
    const problems: string[] = [];
    if (['done', 'closed'].includes(node.status)) {
      const close = (n as any).close;
      if (!close || typeof close.summary !== 'string' || !close.summary.trim()) problems.push('closed node needs close.summary');
      else {
        const room = allow.canonical(allow.cfg.room || pathModule.dirname(pathModule.dirname(pathModule.dirname(path))));
        const summary = allow.canonical(close.summary, room);
        const insideRoom = summary === room || summary.startsWith(room + pathModule.sep);
        if (!insideRoom || !allow.allows(summary) || !fs.existsSync(summary) || !fs.statSync(summary).isFile()) problems.push('close.summary must be an existing file under the allowlisted room tree');
        else {
          const safeClose = { ...close, summary };
          delete safeClose.tokens;
          node.close = safeClose;
        }
      }
      if (!Array.isArray(close?.evidence) || close.evidence.length === 0 || !close.evidence.every((x: unknown) => typeof x === 'string' && x.trim())) problems.push('closed node needs at least one close.evidence entry');
      else if (node.close) node.close.evidence = close.evidence;
      if (Object.prototype.hasOwnProperty.call(close || {}, 'tokens')) problems.push('close.tokens is ignored; token totals are computed by Office');
    } else if ((n as any).close && Object.prototype.hasOwnProperty.call((n as any).close, 'tokens')) {
      // Never honor a number supplied in operations.json.
      const close = { ...(n as any).close };
      delete close.tokens;
      node.close = close;
      problems.push('close.tokens is ignored; token totals are computed by Office');
    }
    if (problems.length) node.closeProblems = problems;
    return node;
  });
  if (unattributed) {
    const belongs = (id: string) => { const mapped = events.map(e => ({ e, op: operationPlacement(e.operation, nodes) })); const descendants = new Set<string>([id]); let changed=true; while(changed){changed=false; for(const n of nodes) if(n.parent && descendants.has(n.parent)&&!descendants.has(n.id)){descendants.add(n.id);changed=true;} } return mapped.filter(x=>x.op&&descendants.has(x.op)).map(x=>x.e); };
    for (const n of output) {
      n.tokenUsage = tokenRollup(belongs(n.id));
      if (n.close) n.close.tokens = n.tokenUsage;
    }
    unfiled.tokenUsage = tokenRollup(events.filter(e=>!operationPlacement(e.operation, nodes)));
  }
  if (unfiled.eventCount) output.push(unfiled);
  return { nodes: output, ...(unattributed ? { unattributed } : {}) };
}
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
