import type { PersonaName } from "./personas/personas";

// deterministic, name-based "seed line" that nudges divergence without prescribing a full personality
export function seedLineFor(persona: PersonaName): string {
  const name = persona.toLowerCase();

  // simple stable hash
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h >>>= 0;

  const signatures = [
  ] as const;

  return signatures[h % signatures.length];
}

const MAX_LINES = 12;
const MAX_LINE_CHARS = 120;

const STATE: Record<string, string[]> = {}; // persona -> lines

export function getPersonaLines(persona: PersonaName): string[] {
  return STATE[persona] ?? [];
}

export function addPersonaLine(persona: PersonaName, rawLine: string) {
  const line = (rawLine ?? "").trim().replace(/\s+/g, " ");
  if (!line) return;

  const clipped = line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) : line;

  const current = STATE[persona] ?? [];
  // de-dupe exact matches
  const filtered = current.filter((l) => l !== clipped);

  STATE[persona] = [clipped, ...filtered].slice(0, MAX_LINES);
}

export function getPersonaMemoryText(persona: PersonaName): string {
  const lines = getPersonaLines(persona);
  if (lines.length === 0) return "";
  return lines.map((l) => `- ${l}`).join("\n");
}

export function getAllPersonaMemory(): Array<{ persona: PersonaName; memory: string }> {
  return Object.entries(STATE).map(([persona, lines]) => ({
    persona: persona as PersonaName,
    memory: lines.map((l) => `- ${l}`).join("\n"),
  }));
}

export function dumpAllPersonaMemory(personas: PersonaName[]): string {
  // pretty text for console
  return personas
    .map((p) => {
      const mem = getPersonaMemoryText(p) || "(empty)";
      return `=== ${p} ===\n${mem}\n`;
    })
    .join("\n");
}
export function exportPersonaMemory(): Record<PersonaName, string[]> {
  // deep copy to avoid mutation
  return JSON.parse(JSON.stringify(STATE));
}

export function importPersonaMemory(
  mem: Record<PersonaName, string[]> | null | undefined
) {
  if (!mem) return;
  for (const [persona, lines] of Object.entries(mem)) {
    STATE[persona] = [...lines];
  }
}

// ---- Optional manual persona override text (for MANUAL persona mode) ----
const OVERRIDES: Partial<Record<PersonaName, string>> = {};

export function setPersonaOverride(persona: PersonaName, text: string) {
  const t = (text ?? "").trim();
  if (!t) {
    delete OVERRIDES[persona];
    return;
  }
  OVERRIDES[persona] = t;
}

export function clearPersonaOverride(persona: PersonaName) {
  delete OVERRIDES[persona];
}

export function getPersonaOverride(persona: PersonaName): string | null {
  return OVERRIDES[persona] ?? null;
}
export function freezePersona(name: PersonaName) {
  const memoryText = getPersonaMemoryText(name);

  if (!memoryText.trim()) return;

  setPersonaOverride(
    name,
    `You are ${name}.
${memoryText}

Rules:
- Stay consistent with this persona.
- Do not mention being frozen or emergent.
`
  );
}
export function exportPersonaOverrides(): Partial<Record<PersonaName, string>> {
  return JSON.parse(JSON.stringify(OVERRIDES));
}

export function importPersonaOverrides(
  overrides: Partial<Record<PersonaName, string>> | null | undefined
) {
  if (!overrides) return;
  for (const [persona, text] of Object.entries(overrides) as [PersonaName, string][]) {
    if (!text) continue;
    OVERRIDES[persona] = String(text);
  }
}
