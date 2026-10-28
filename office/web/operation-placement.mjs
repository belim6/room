// Canonical event placement for operation trees. A key matches exactly or as
// a slash-delimited prefix; the longest key wins.
export function operationPlacement(operation, nodes) {
  if (typeof operation !== 'string' || !operation) return null;
  let best = null;
  for (const node of nodes || []) {
    if (node.id === 'unfiled') continue;
    for (const key of [node.id, ...(node.aliases || [])]) {
      if ((operation === key || operation.startsWith(key + '/')) && (!best || key.length > best.key.length)) {
        best = { id: node.id, key };
      }
    }
  }
  return best?.id || null;
}
