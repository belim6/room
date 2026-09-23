import { PERSONAS } from "./personas/personas";
import type { PersonaName } from "./personas/personas";

export const ALL_PARTICIPANTS = Object.keys(PERSONAS) as PersonaName[];

export function validateParticipants(value: unknown): PersonaName[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("Choose at least one participant.");
  const names = value.map(raw => {
    const name = typeof raw === "string"
      ? ALL_PARTICIPANTS.find(p => p.toLowerCase() === raw.toLowerCase())
      : undefined;
    if (!name) throw new Error(`Unknown participant: ${String(raw)}. Available: ${ALL_PARTICIPANTS.join(", ")}`);
    return name;
  });
  return [...new Set(names)];
}

export function parseParticipants(input: string): PersonaName[] {
  if (input.trim().toLowerCase() === "all") return [...ALL_PARTICIPANTS];
  return validateParticipants(input.trim().split(/[\s,]+/).filter(Boolean));
}
