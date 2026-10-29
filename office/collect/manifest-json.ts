import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

export interface ManifestRecord { r: any; i: number }
export interface ParsedManifest { records: ManifestRecord[]; unparsed: number }
const isRecord = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);

export function manifestRecords(text: string): ParsedManifest {
  try {
    const value: unknown = JSON.parse(text);
    if (Array.isArray(value)) {
      const records = value.filter(isRecord).map(r => ({ r, i: 0 }));
      return { records, unparsed: value.length - records.length };
    }
    if (isRecord(value)) return { records: [{ r: value, i: 0 }], unparsed: 0 };
    return { records: [], unparsed: 1 };
  } catch {}
  const records: ManifestRecord[] = []; let unparsed = 0;
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try { const value: unknown = JSON.parse(line); if (isRecord(value)) records.push({ r: value, i }); else unparsed++; } catch { unparsed++; }
  });
  return { records, unparsed };
}

// JSONL raw input memory is bounded by one 64 KiB read chunk plus the longest
// line. Parsed records remain O(record count). Pretty-printed JSON is accepted
// through the shared parser's whole-document fallback.
export function manifestFileRecords(file: string): ParsedManifest {
  const fd = fs.openSync(file, 'r'), bytes = Buffer.allocUnsafe(64 * 1024), decoder = new StringDecoder('utf8');
  let carry = '', lineNo = 0, firstContent = true, mode: 'jsonl' | 'document' | undefined;
  const records: ManifestRecord[] = []; let unparsed = 0;
  const parseLine = (line: string) => {
    if (!line.trim()) { lineNo++; return; }
    if (firstContent) {
      firstContent = false;
      try {
        const first: unknown = JSON.parse(line);
        if (Array.isArray(first)) mode = 'document'; else mode = 'jsonl';
      } catch { mode = 'document'; }
    }
    if (mode === 'document') return;
    try { const value: unknown = JSON.parse(line); if (isRecord(value)) records.push({ r: value, i: lineNo }); else unparsed++; } catch { unparsed++; }
    lineNo++;
  };
  try {
    while (true) {
      const n = fs.readSync(fd, bytes, 0, bytes.length, null); if (!n) break;
      carry += decoder.write(bytes.subarray(0, n));
      let cut: number;
      while ((cut = carry.indexOf('\n')) >= 0) { parseLine(carry.slice(0, cut)); carry = carry.slice(cut + 1); }
    }
  } finally { fs.closeSync(fd); }
  carry += decoder.end();
  if (carry.trim()) parseLine(carry);
  if (mode === 'document') return manifestRecords(fs.readFileSync(file, 'utf8'));
  return { records, unparsed };
}
