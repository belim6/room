import { fileTitle } from './legible';
import { visibleDocuments } from './deny';
import { operationPlacement } from '../web/operation-placement.mjs';
import type { Allowlist } from './privacy';
import type { Artifact, OperationNode } from './types';

export function nodeDocuments(id: string, nodes: OperationNode[], artifacts: Artifact[], allow: Allowlist) {
  const ids = new Set([id]); let changed = true;
  while (changed) { changed = false; for (const n of nodes) if (n.parent && ids.has(n.parent) && !ids.has(n.id)) { ids.add(n.id); changed = true; } }
  const titles = new Map<string, string>();
  const items = visibleDocuments(artifacts, allow).filter(a => id === 'unfiled' ? !operationPlacement(a.operation, nodes) : ids.has(operationPlacement(a.operation, nodes) || '')).map(a => ({ path: a.path, title: fileTitle(a.path, allow, titles), mtime: a.mtime, operation: operationPlacement(a.operation, nodes) || 'unfiled' }));
  const rank = (a: typeof items[number]) => { const p = a.path.toLowerCase(); if (/\.raw\.log$/.test(p)) return 5; if (/(close|summary|results?)/.test(p)) return 0; if (/(plan|readme)/.test(p)) return 1; if (/critic/.test(p)) return 2; if (/(deniz|packet)/.test(p)) return 3; if (/\.(sh|py|js|mjs|ts)$/.test(p)) return 4; return 6; };
  items.sort((a,b) => rank(a)-rank(b) || (rank(a)===2 ? b.mtime.localeCompare(a.mtime) : a.title.localeCompare(b.title)));
  return items;
}

export function artifactDocumentCounts(nodes: OperationNode[], artifacts: Artifact[], allow: Allowlist) {
  const counts = new Map(nodes.filter(n => n.id !== 'unfiled').map(n => [n.id, 0])); let unfiled = 0;
  for (const a of visibleDocuments(artifacts, allow)) { const placed = operationPlacement(a.operation, nodes); if (placed) counts.set(placed, (counts.get(placed) || 0) + 1); else unfiled++; }
  return { counts, unfiled };
}
