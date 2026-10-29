import type { OfficeEvent } from './types';
import type { OperationTree } from './operations';
import { operationPlacement } from '../web/operation-placement.mjs';

// Preserve event order; each event is placed once, then included in its ancestors.
export function eventNodeIndex(events: OfficeEvent[], tree?: OperationTree) {
  const nodes = tree?.nodes || [], parents = new Map(nodes.map(n => [n.id, n.parent]));
  const index = new Map<string, OfficeEvent[]>(nodes.map(n => [n.id, []]));
  const placements = new Map<string | undefined, string | null>();
  for (const event of events) {
    if (!placements.has(event.operation)) placements.set(event.operation, operationPlacement(event.operation, nodes));
    let id = placements.get(event.operation) || 'unfiled';
    const seen = new Set<string>();
    while (id && !seen.has(id)) { seen.add(id); index.get(id)?.push(event); id = parents.get(id) || ''; }
  }
  return index;
}
