// src/jevLog.ts — records every Jev selection so the room's routing can be audited.
import fs from "fs";
import path from "path";
import type { PersonaName } from "./personas/personas";
import { PERSONAS } from "./personas/personas";

const PERSONA_LIST = Object.keys(PERSONAS) as PersonaName[];
const SAVE_DIR = path.resolve(process.cwd(), "saves");

/** Mirrors snapshot.ts's filename sanitising so the two files stay siblings. */
function sidecarPathFor(id: string) {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(SAVE_DIR, `${safe}.jev.jsonl`);
}

export interface JevTurnRecord {
  at: string;
  /** null when the confidence gate produced silence. */
  chosen: PersonaName | null;
  argmax: PersonaName;
  confidence: number;
  latencyMs: number;
  probabilities: Record<string, number>;
  silenced: boolean;
  /** Present on new records; old saves remain compatible. */
  silenceBreaker?: boolean;
}

const TURNS: JevTurnRecord[] = [];

export function recordTurn(r: Omit<JevTurnRecord, "at">) {
  TURNS.push({ at: new Date().toISOString(), ...r });
}

export function resetTurns() {
  TURNS.length = 0;
}

export function turnCount() {
  return TURNS.length;
}

/**
 * Write this session's Jev decisions beside the snapshot as `<id>.jev.jsonl`.
 * Called from /save. Returns the number of records written.
 */
export function saveTurnsFor(id: string): number {
  const file = sidecarPathFor(id);
  if (TURNS.length === 0) {
    // Nothing to record: remove a stale sidecar rather than leave it lying to us.
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      /* non-fatal */
    }
    return 0;
  }
  fs.mkdirSync(SAVE_DIR, { recursive: true });
  fs.writeFileSync(file, TURNS.map((t) => JSON.stringify(t)).join("\n") + "\n", "utf8");
  return TURNS.length;
}

/**
 * Restore the Jev decisions belonging to a snapshot. Called from /load.
 * Returns the number of records loaded; a snapshot saved before this feature,
 * or one taken while selection was random, simply has no sidecar.
 */
export function loadTurnsFor(id: string): number {
  const file = sidecarPathFor(id);
  TURNS.length = 0;
  if (!fs.existsSync(file)) return 0;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      TURNS.push(JSON.parse(line) as JevTurnRecord);
    } catch {
      /* skip a malformed line rather than fail the load */
    }
  }
  return TURNS.length;
}

function bar(frac: number, width = 20) {
  const n = Math.round(frac * width);
  return "█".repeat(n) + "░".repeat(width - n);
}

/** Discord-ready report over the turns since process start (or last /jevreport reset). */
export function formatReport(): string {
  if (TURNS.length === 0) return "No Jev turns recorded yet. Try `/select jev` and talk to the room.";

  const spoken = TURNS.filter((t) => !t.silenced);
  const silences = TURNS.length - spoken.length;

  // Actual speaking share
  const picks: Record<string, number> = {};
  for (const t of spoken) if (t.chosen) picks[t.chosen] = (picks[t.chosen] ?? 0) + 1;

  // Mean probability Jev assigned to each persona across all turns — what it
  // *wanted*, as opposed to what the sampling actually produced.
  const meanProb: Record<string, number> = {};
  for (const p of PERSONA_LIST) {
    meanProb[p] = TURNS.reduce((s, t) => s + (t.probabilities[p] ?? 0), 0) / TURNS.length;
  }

  const meanConf = TURNS.reduce((s, t) => s + t.confidence, 0) / TURNS.length;
  const meanLat = TURNS.reduce((s, t) => s + t.latencyMs, 0) / TURNS.length;
  const regular = spoken.filter((t) => !t.silenceBreaker);
  const breakers = spoken.length - regular.length;
  const argmaxAgree = regular.filter((t) => t.chosen === t.argmax).length;

  const rows = PERSONA_LIST.map((p) => {
    const n = picks[p] ?? 0;
    const share = spoken.length ? n / spoken.length : 0;
    return { p, n, share, mean: meanProb[p] };
  }).sort((a, b) => b.share - a.share || b.mean - a.mean);

  const lines = rows.map(
    (r) =>
      `\`${r.p.padEnd(9)} ${String(r.n).padStart(3)} turns ${(r.share * 100).toFixed(1).padStart(5)}%  ${bar(r.share)}  mean p ${(r.mean * 100).toFixed(1).padStart(5)}%\``
  );

  return [
    `**Jev routing report** — ${TURNS.length} decisions, ${spoken.length} spoken, ${silences} silenced, ${breakers} topic changes`,
    "",
    ...lines,
    "",
    `\`mean confidence ${meanConf.toFixed(3)} · mean latency ${Math.round(meanLat)}ms\``,
    `\`sampling followed argmax ${argmaxAgree}/${regular.length} (${regular.length ? ((argmaxAgree / regular.length) * 100).toFixed(0) : 0}%)\``,
    silences ? `\`${silences} turn(s) fell below the ${(TURNS[0] ? "" : "")}confidence gate\`` : "",
    `_Per-turn records are written beside the snapshot on /save._`,
  ]
    .filter(Boolean)
    .join("\n");
}
