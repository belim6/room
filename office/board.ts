import fs from 'node:fs';
import path from 'node:path';
import { type Config, type Allowlist, redactDeep } from './collect/privacy';
import { isRole } from './collect/roles';
import { deniedBoardText } from './collect/deny';
export type Room = 'work' | 'leisure';
export interface Message { id: string; at: string; room: Room; author: { role: string; kind: 'human' | 'session' | 'standin' }; text: string; replyTo?: string; mentions: string[]; link?: string }
export class BoardError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function roomOf(room: string): Room { if (room !== 'work' && room !== 'leisure') throw new BoardError('Unknown board room', 404); return room; }
export const boardDir = (cfg: Config) => cfg.board || path.join(cfg.room || path.join(cfg.home, 'dev/room'), 'board');
const mentionable = new Set(['operator', 'coordinator', 'partner', 'experimenter', 'engineer', 'jev-correspondent', 'prompter', 'brainstormer', 'intern']);
export const mentions = (text: string) => [...new Set([...text.matchAll(/(?<![\w@.-])@([a-z][a-z0-9-]*)(?![\w-])/g)].map(m => m[1]).filter(r => mentionable.has(r)))];
export function input(room: Room, body: any): Pick<Message, 'text' | 'link' | 'replyTo' | 'mentions'> {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['text', 'link', 'replyTo'].includes(k))) throw new BoardError('Only text, link and replyTo are accepted');
  if (typeof body.text !== 'string' || !body.text.trim() || [...body.text].length > 2000 || (body.text.match(/(?:\r\n|[\r\n\u2028\u2029])+/g) || []).length > 1) throw new BoardError('Text requires 1–2000 characters and at most one line-break run');
  if (body.link !== undefined && (typeof body.link !== 'string' || !body.link || body.link.length > 2000 || /[\x00-\x1f\x7f]/.test(body.link))) throw new BoardError('Invalid link');
  if (body.replyTo !== undefined && (typeof body.replyTo !== 'string' || !new RegExp(`^${room[0]}-\\d{6,}$`).test(body.replyTo))) throw new BoardError('Invalid replyTo');
  return { text: body.text, mentions: mentions(body.text), ...(body.link !== undefined ? { link: body.link } : {}), ...(body.replyTo !== undefined ? { replyTo: body.replyTo } : {}) };
}
export function readBoard(cfg: Config, room: Room): Message[] {
  roomOf(room);
  let raw: string; try { raw = fs.readFileSync(path.join(boardDir(cfg), room + '.jsonl'), 'utf8'); } catch (e: any) { if (e.code === 'ENOENT') return []; throw new BoardError('Board unavailable', 503); }
  if (raw && !raw.endsWith('\n')) throw new BoardError('Board has an incomplete append; repair required', 503);
  try { return raw.split('\n').filter(Boolean).map(s => JSON.parse(s)); } catch { throw new BoardError('Board has an invalid record; repair required', 503); }
}
export function appendBoard(cfg: Config, room: Room, body: unknown, author: Message['author']): Message {
  roomOf(room); const value = input(room, body);
  if (!(author.kind === 'human' && author.role === 'deniz') && !(author.kind === 'session' && isRole(author.role))) throw new BoardError('Stand-in or invalid author refused');
  if (author.kind === 'session' && room === 'leisure' && /@[a-z][\w-]*/i.test(value.text)) throw new BoardError('Session leisure posts cannot @mention');
  const dir = boardDir(cfg), lock = path.join(dir, room + '.lock'); fs.mkdirSync(dir, { recursive: true });
  if (fs.lstatSync(dir).isSymbolicLink()) throw new BoardError('Board directory must not be a symlink', 500);
  for (let i = 0; ; i++) { try { fs.mkdirSync(lock); break; } catch (e: any) { if (e.code !== 'EEXIST' || i >= 250) throw new BoardError('Board locked or unavailable', 503); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); } }
  try {
    const rows = readBoard(cfg, room), last = rows.at(-1), n = last ? Number(last.id.slice(2)) + 1 : 1;
    if (!Number.isSafeInteger(n)) throw new BoardError('Board id exhausted', 503);
    const message: Message = { id: `${room[0]}-${String(n).padStart(6, '0')}`, at: new Date().toISOString(), room, author: { ...author }, ...value };
    const line = Buffer.from(JSON.stringify(message) + '\n'), fd = fs.openSync(path.join(dir, room + '.jsonl'), fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW, 0o600);
    try { if (fs.writeSync(fd, line) !== line.length) throw new BoardError('Incomplete board append; repair required', 503); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return message;
  } finally { fs.rmdirSync(lock); }
}
export function pageBoard(cfg: Config, room: Room, after?: string, limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new BoardError('Limit must be 1–1000');
  if (after !== undefined && !new RegExp(`^${room[0]}-\\d{6,}$`).test(after)) throw new BoardError('Invalid after id');
  const rows = readBoard(cfg, room); return after === undefined ? rows.slice(-limit) : rows.filter(m => Number(m.id.slice(2)) > Number(after.slice(2))).slice(0, limit);
}
export function visibleMessage(m: Message, allow: Allowlist): Message {
  const hidden = deniedBoardText(m.text, allow) || (m.link && deniedBoardText(m.link, allow));
  const { link, ...rest } = m;
  return redactDeep(hidden ? { ...rest, text: 'withheld by the Office deny-list', mentions: [] } : m) as Message;
}
