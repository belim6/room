import path from 'node:path';
import type { Allowlist } from './privacy';

/** One path-based policy for every Office artifact surface. */
export function deniedDocument(p: string, allow: Allowlist): boolean {
  const c = allow.canonical(p).toLowerCase();
  const rel = c.split(path.sep).filter(Boolean);
  if (rel.some(s => s === 'restricted' || s === 'labels' || s === '.room-data')) return true;
  if (rel.some((s, i) => s === 'archive' && ['private', 'personality'].includes(rel[i + 1] || ''))) return true;
  if (rel.some(s => /^conversation-\d{2}\.md$/i.test(s))) return true;
  if (rel.slice(-3).join('/') === 'roles/partner/deniz-model.md') return true;
  return !!allow.blind?.(c);
}

export function visibleDocuments<T extends { path: string }>(items: T[], allow: Allowlist): T[] {
  return items.filter(item => !deniedDocument(item.path, allow));
}
