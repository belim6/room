import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export const id = () => randomUUID();
export const clone = <T>(value: T): T => structuredClone(value);
export type Write = (kind: string, key: string, value: any) => void;
export class Store {
  private listeners = new Set<Write>();
  // Called after each durable write; a listener failure never fails the write.
  subscribe(fn: Write) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  get subscribers() { return this.listeners.size; }
  // Read-only instances (ROOM_READONLY=1, restore verification) refuse every write instead of creating files.
  constructor(public root: string, public readOnly = false) { if (!readOnly) fs.mkdirSync(root, { recursive: true, mode: 0o700 }); }
  file(kind: string, key: string) {
    if (!/^[a-z-]+$/.test(kind) || !/^[a-zA-Z0-9_-]+$/.test(key)) throw Error('Invalid record identifier');
    return path.join(this.root, kind, key + '.json');
  }
  put(kind: string, key: string, value: unknown) {
    const target = this.file(kind, key);
    if (this.readOnly) throw Error('This instance is read-only; nothing was saved.');
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const temp = target + '.' + id() + '.tmp';
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, target);
    for (const fn of this.listeners) try { fn(kind, key, value); } catch {}
  }
  add(kind: string, value: any) { const key = value.id || id(); this.put(kind, key, { ...value, id: key }); return key; }
  get<T = any>(kind: string, key: string): T { return JSON.parse(fs.readFileSync(this.file(kind, key), 'utf8')); }
  list<T = any>(kind: string): T[] {
    const dir = path.join(this.root, kind);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => this.get<T>(kind, f.slice(0, -5)));
  }
  attempts() {
    const outcomes = new Map(this.list('outcomes').map(o => [o.id, o]));
    return this.list('attempts').map(a => ({ ...a, outcome: outcomes.get(a.id) ?? null }));
  }
}
