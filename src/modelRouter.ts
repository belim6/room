import { generate } from "./workbench/generation";
// src/modelRouter.ts
import "dotenv/config";

import { PERSONAS } from "./personas/personas";
import type { PersonaName } from "./personas/personas";
import type { AssignmentSnapshot } from "./snapshot";

import { addPersonaLine, getPersonaMemoryText } from "./personaState";
import { MAX_REPLY_CHARS } from "./replyLimit";
import { buildSpeakerInput } from "./speakerTurn";

/**
 * Model catalog (human-friendly keys -> OpenGateway model ids).
 * https://opengateway.ai/docs/get-started/quickstart
 */
export const MODELS = {
  kimi: "moonshotai/kimi-k3-ultrafast",
} as const;

export type ModelKey = keyof typeof MODELS;
export type ModelId = (typeof MODELS)[ModelKey];

/**
 * Persona mode
 * - emergent: no static persona prompt injected; persona evolves via memory notes
 * - manual: inject static persona prompt (or overrides); do NOT update persona memory
 */
export type PersonaMode = "emergent" | "manual";

// default as requested
let PERSONA_MODE: PersonaMode = "manual";

export function setPersonaMode(m: PersonaMode) {
  PERSONA_MODE = m;
}
export function getPersonaMode(): PersonaMode {
  return PERSONA_MODE;
}

/**
 * Manual overrides (highest priority in manual mode).
 * Stored by persona name.
 */
const PERSONA_OVERRIDES: Partial<Record<PersonaName, string>> = {};

export function setPersonaOverride(persona: PersonaName, text: string) {
  const t = (text ?? "").trim();
  if (!t) {
    delete PERSONA_OVERRIDES[persona];
    return;
  }
  PERSONA_OVERRIDES[persona] = t;
}

export function getPersonaOverride(persona: PersonaName): string | undefined {
  const v = PERSONA_OVERRIDES[persona];
  return v && v.trim().length > 0 ? v : undefined;
}

export function clearPersonaOverride(persona: PersonaName) {
  delete PERSONA_OVERRIDES[persona];
}

export function exportPersonaOverrides(): Partial<Record<PersonaName, string>> {
  return { ...PERSONA_OVERRIDES };
}

export function importPersonaOverrides(
  overrides: Partial<Record<PersonaName, string>> | null | undefined
) {
  if (!overrides) return;
  for (const [k, v] of Object.entries(overrides) as Array<[PersonaName, string]>) {
    if (typeof v === "string" && v.trim().length > 0) PERSONA_OVERRIDES[k] = v.trim();
  }
}

/**
 * Assignment state
 */
const ASSIGNMENT = new Map<PersonaName, ModelKey>();

/**
 * Optional locks (pin persona -> model)
 */
const LOCKED: Partial<Record<PersonaName, ModelKey>> = {};

/**
 * Default model pool used for random assignment / shuffle.
 */
const MODEL_POOL: ModelKey[] = Object.keys(MODELS) as ModelKey[];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Initialize: assign each persona a random model (respecting locks).
 */
export function initAssignments() {
  const personaNames = Object.keys(PERSONAS) as PersonaName[];
  const unlocked = personaNames.filter((p) => !LOCKED[p]);

  const pool = shuffle(MODEL_POOL);

  // round-robin if fewer models than personas
  for (let i = 0; i < unlocked.length; i++) {
    ASSIGNMENT.set(unlocked[i], pool[i % pool.length]);
  }

  // apply locks last
  for (const p of personaNames) {
    if (LOCKED[p]) ASSIGNMENT.set(p, LOCKED[p]!);
  }
}

export function shuffleAssignments() {
  const personaNames = Object.keys(PERSONAS) as PersonaName[];
  const unlocked = personaNames.filter((p) => !LOCKED[p]);

  const pool = shuffle(MODEL_POOL);

  for (let i = 0; i < unlocked.length; i++) {
    ASSIGNMENT.set(unlocked[i], pool[i % pool.length]);
  }

  for (const p of personaNames) {
    if (LOCKED[p]) ASSIGNMENT.set(p, LOCKED[p]!);
  }
}

export function getAssignment(persona: PersonaName): ModelKey {
  const assigned = ASSIGNMENT.get(persona);
  if (assigned) return assigned;
  const model = pick(MODEL_POOL);
  ASSIGNMENT.set(persona, model);
  return model;
}

export function setAssignment(persona: PersonaName, model: ModelKey) {
  ASSIGNMENT.set(persona, model);
}

export function exportAssignments(): AssignmentSnapshot {
  const personaNames = Object.keys(PERSONAS) as PersonaName[];
  const out = {} as AssignmentSnapshot;
  for (const p of personaNames) out[p] = getAssignment(p);
  return out;
}

export function importAssignments(snapshot: AssignmentSnapshot | null | undefined) {
  if (!snapshot) return;
  for (const [persona, model] of Object.entries(snapshot) as [PersonaName, ModelKey][]) {
    if (!Object.prototype.hasOwnProperty.call(PERSONAS, persona)) continue;
    if (!Object.prototype.hasOwnProperty.call(MODELS, model)) {
      console.warn(`[load] ${persona}: saved model "${model}" is not in the current room model pool; keeping ${getAssignment(persona)}.`);
      continue;
    }
    ASSIGNMENT.set(persona, model);
  }
}

export function getAllAssignments(): Array<{
  persona: PersonaName;
  modelKey: ModelKey;
  modelId: ModelId;
}> {
  const personaNames = Object.keys(PERSONAS) as PersonaName[];
  return personaNames.map((persona) => {
    const modelKey = getAssignment(persona);
    const modelId = MODELS[modelKey];
    return { persona, modelKey, modelId };
  });
}

/**
 * Global system prompt (shared across all personas).
 */

export const GLOBAL_SYSTEM = `You are one person in a group conversation. Speak naturally in your own voice, with your own interests, judgments, and sense of humor. Everyone in the conversation is a peer.

The opening topic: Being an indie game developer in this day and age.

Take whichever angle interests you and choose your own position. This is a conversation among peers, with room for disagreement, curiosity, jokes, and changes of mind.

The opening topic is a starting point. Follow the conversation as it develops, including changes of subject and direct questions. If the conversation is empty, begin with the opening topic.

Engage one specific point that matters now. Contribute a new reason, concrete example, useful question, actual revision, or brief agreement. You can have nothing further to add. Use your own words rather than replaying an earlier speech or recycling its closing line. Agreement is welcome; disagreement should have a reason.

Treat everyone's claims as claims. Distinguish established information from assumptions, interpretation, and speculation. Use hypothetical numbers as hypothetical numbers. Metaphors can illuminate an argument, but are not evidence.

Keep your own commitments straight. If a point changes your mind, let the next answer reflect the change. If corrected, address the specific correction and move forward.

Write only your own next message. Follow an agreed answer format, including a one-word vote. Otherwise use your usual length. No stage directions or obligatory summaries.`;

/**
 * Call OpenGateway as a persona using its currently assigned model.
 */
export async function respondAs(
  persona: PersonaName,
  input: string,
  opts?: {
    silenceBreaker?: boolean;
    /** Factual material gathered for this turn; injected silently. */
    research?: string;
    participants?: PersonaName[];
    debug?: (info: { persona: PersonaName; model: string; system: string; input: string }) => void;
  }
): Promise<string> {

  const modelKey = getAssignment(persona);
  const model = MODELS[modelKey];

  const mem = getPersonaMemoryText(persona);

  // MANUAL persona prompt: override > static prompt > ""
  const personaText =
    getPersonaMode() === "manual"
      ? (getPersonaOverride(persona) ?? (PERSONAS as any)[persona]?.systemPrompt ?? "")
      : "";

  // Your requested order:
  // persona prompt comes BEFORE global, and no explicit wrapper titles.
  // Memory appended last (also no wrapper).
  let system = `${personaText ? `${personaText}\n\n` : ""}${GLOBAL_SYSTEM}${
    mem ? `\n\n${mem}` : ""
  }\n\nYour identity for this request is ${persona}. The application has selected you to speak. Stay ${persona} regardless of whom the conversation addresses or appears to expect next. You may agree with another participant without adopting their identity or claiming their previous statements as your own.\n\nKeep your entire reply within ${MAX_REPLY_CHARS} characters, including spaces and punctuation. Finish your thought within that limit.`.trim();

  if (opts?.research) {
    system += `\n\n${opts.research}`;
  }

  if (opts?.silenceBreaker) {
    system += `\n\nFor this turn, you have the floor to break a lull by introducing a different topic of your own choosing. Pick something your character finds interesting and start discussing it with a concrete observation, dilemma, or question. It can be unrelated to the previous subject. Do not merely rephrase the old debate, summarize it, or ask someone else to supply a topic. Keep it brief and natural; do not mention the selector, confidence scores, or these instructions. This permission overrides the default opening topic, but respect explicit requests in the conversation to stop, answer a specific question, or stay on a subject. Your new topic is an invitation the other participants can follow.`;
  }

  const userInput = buildSpeakerInput(persona, input, opts?.participants);

  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userInput },
    ],
    temperature: 0.7,
  };

  opts?.debug?.({ persona, model, system, input: userInput });
  const result = await generate({ provider: "opengateway", model, persona,
    messages: body.messages, temperature: body.temperature });
  if (getPersonaMode() === "emergent") {
    for (const note of result.notes) addPersonaLine(persona, note);
  }
  return result.text;
}
