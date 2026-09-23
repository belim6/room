 import fs from "node:fs/promises";
import path from "node:path";

import type { PersonaName } from "./personas/personas";
import type { ModelKey, PersonaMode } from "./modelRouter";

export type AssignmentSnapshot = Record<PersonaName, ModelKey>;

export interface Snapshot {
  id: string;
  savedAt: string;
  history: string[];
  assignments: AssignmentSnapshot;
  lastSpeaker: PersonaName | null;
  participants?: PersonaName[];

  // NEW:
  personaMode?: PersonaMode;
  personaOverrides?: Partial<Record<PersonaName, string>>;
  personaMemory?: Record<PersonaName, string[]>;
}


const SAVE_DIR = path.resolve(process.cwd(), "saves");

async function ensureDir() {
  await fs.mkdir(SAVE_DIR, { recursive: true });
}

function filePathFor(id: string) {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(SAVE_DIR, `${safe}.json`);
}

export async function saveSnapshot(snap: Snapshot) {
  await ensureDir();
  await fs.writeFile(filePathFor(snap.id), JSON.stringify(snap, null, 2), "utf8");
}

export async function loadSnapshot(id: string): Promise<Snapshot> {
  const raw = await fs.readFile(filePathFor(id), "utf8");
  const json = JSON.parse(raw);

  if (!json || typeof json !== "object") throw new Error("Save file is not an object snapshot.");
  if (!Array.isArray(json.history)) throw new Error("Save file history is not string[].");
  if (!json.assignments || typeof json.assignments !== "object") throw new Error("Save file assignments missing.");

  return json as Snapshot;
}

