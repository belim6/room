// src/jevSpeaker.ts
// Speaker selection via TypeSafe's Jev (System One) Choice primitive.
// Docs: https://docs.typesafe.ai/introduction  | POST https://api.typesafe.ai/v1/systemone
//
// This module only answers WHO speaks next. Generating the persona's actual
// message stays with modelRouter/respondAs.

import { validateParticipants } from "./participants";
import { PERSONAS } from "./personas/personas";
import type { PersonaName } from "./personas/personas";

// ---- Tunables (all in one place on purpose) ----
export const JEV_MODEL = "jev-latest";
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
/** Transcript lines fed to Jev as `state`. */
export const JEV_STATE_LINES = 20;
/** Below this confidence, select a random silence breaker to introduce a topic. Set to 0 to disable. */
export const JEV_CONFIDENCE_GATE = 0.35;
/** Wall-clock budget for the selection call; on timeout the caller falls back. */
export const JEV_TIMEOUT_MS = 4000;
/** Noul probability above which the speaking persona gets a web lookup first. */
/** Confidence Jev must reach before it takes the room over from you. */
export const JEV_HANDOVER_THRESHOLD = Number(process.env.JEV_HANDOVER_THRESHOLD ?? 0.55);
/** Consecutive confident calls required, so one lucky turn does not hand over. */
export const JEV_HANDOVER_STREAK = Number(process.env.JEV_HANDOVER_STREAK ?? 2);
export const JEV_RESEARCH_THRESHOLD = Number(process.env.JEV_RESEARCH_THRESHOLD ?? 0.6);

const PERSONA_LIST = Object.keys(PERSONAS) as PersonaName[];

/** The human seat, so Jev can tell participants' turns from the human's. */
export const HUMAN_NAME = process.env.USER_NAME || "Dennis";

/** What the room is. Facts about the setting belong in state, not in instructions. */
export const ROOM_DESCRIPTION =
  "One Discord channel. Several AI characters with distinct intellectual priorities, plus one human participant, in a single ongoing conversation. Exactly one character speaks per turn. Characters may disagree, concede, change the subject, or let a question go unanswered.";

/**
 * Build Jev's option descriptions straight from the persona prompts, so the
 * router can never drift out of sync with personas.ts. Each persona prompt has
 * a "You care about ..." sentence; that is its intellectual priority.
 */
function priorityOf(persona: PersonaName): string {
  const prompt = PERSONAS[persona].systemPrompt;
  const m = prompt.match(/You care about ([^.]+\.)/);
  if (m) return m[1].trim();
  // Fallback: the voice line after "You are X:"
  const v = prompt.match(/^You are [A-Za-z]+:\s*([^.]+\.)/m);
  return v ? v[1].trim() : `${persona}, a participant in the room.`;
}

export const PERSONA_CRITERIA: Record<string, { what: string }> = Object.fromEntries(
  PERSONA_LIST.map((p) => [p, { what: priorityOf(p) }])
);

export interface JevPick {
  persona: PersonaName;
  /** Jev's confidence in its own top choice (not in the sampled persona). */
  confidence: number;
  probabilities: Record<string, number>;
  /** Highest-probability option, before weighted sampling. */
  argmax: PersonaName;
  /** Noul: probability that this turn needs a checkable external fact. 0 when unavailable. */
  researchP: number;
  latencyMs: number;
}

export class JevError extends Error {}

function apiKey(): string {
  const k = process.env.TYPESAFE_API_KEY;
  if (!k) throw new JevError("TYPESAFE_API_KEY missing from .env");
  return k;
}

/** Weighted sample over a probability map, optionally excluding one persona. */
export function sampleFrom(
  probabilities: Record<string, number>,
  exclude?: PersonaName | null,
  participants: PersonaName[] = PERSONA_LIST
): PersonaName {
  const active = validateParticipants(participants);
  const eligible = active.filter(p => p !== exclude);
  const entries = (eligible.length ? eligible : active)
    .map((p) => [p, probabilities[p] ?? 0] as [PersonaName, number]);

  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) {
    // Degenerate distribution: uniform over the eligible personas.
    const pool = entries.length ? entries : active.map((p) => [p, 1] as [PersonaName, number]);
    return pool[Math.floor(Math.random() * pool.length)][0];
  }

  let r = Math.random() * total;
  for (const [p, w] of entries) {
    r -= w;
    if (r <= 0) return p;
  }
  return entries[entries.length - 1][0];
}

/** Raw Choice call. Returns the full distribution; no sampling, no gating. */
export async function askJev(transcript: string[], participants: PersonaName[] = PERSONA_LIST): Promise<JevPick> {
  const active = validateParticipants(participants);
  if (active.length === 1) return { persona: active[0], argmax: active[0], confidence: 1, probabilities: { [active[0]]: 1 }, latencyMs: 0, researchP: 0 };
  const lines = transcript.slice(-JEV_STATE_LINES);
  const lastPersonaLine = [...lines].reverse().find((l) => !l.startsWith(`${HUMAN_NAME}:`));

  // Object state: named fields the instructions can point at, rather than one
  // undifferentiated blob. Keeps each question focused on the field it needs.
  const state = {
    room: ROOM_DESCRIPTION,
    participants: active,
    transcript: lines.length ? lines : ["(the conversation has not started yet)"],
    latest_message: lines[lines.length - 1] ?? "(none)",
    last_speaker: lastPersonaLine ? lastPersonaLine.split(":")[0] : "(none)",
  };

  const body = {
    state,
    model: JEV_MODEL,
    questions: {
      next_speaker: {
        type: "choice",
        instructions: [
          "Pick who speaks next in `transcript`.",
          "Choose the participant whose specific intellectual priority is most directly engaged by `latest_message` \u2014 the claim, question, or move actually on the table right now, not the general subject of the conversation.",
          "A participant is the right choice when the turn would be worse without their particular angle: an unexamined assumption, an untested constraint, a missing distinction, an excluded possibility, a practical consequence.",
          "Do not choose for balance, fairness, or to spread turns around. Do not choose `last_speaker`.",
          "Prefer the participant who can advance the exchange over one who would only agree, restate, or comment on the conversation itself.",
          "If `latest_message` asks a direct question of the room, choose whoever is best placed to answer that question.",
        ].join(" "),
        criteria: Object.fromEntries(active.map(p => [p, PERSONA_CRITERIA[p]])),
      },
      needs_research: {
        type: "noul",
        instructions:
          "Would the next contribution to `transcript` be materially better if the speaker first looked up a verifiable external fact \u2014 a figure, date, name, quote, event, or what a cited source actually says? Answer yes only when `latest_message` turns on something checkable that the participants do not already have. Speculation, values, definitions, jokes, and questions about the participants themselves do not need a lookup.",
      },
    },
  };

  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), JEV_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(JEV_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch (e: any) {
    throw new JevError(e?.name === "AbortError" ? `timed out after ${JEV_TIMEOUT_MS}ms` : String(e));
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = Date.now() - started;

  if (!res.ok) {
    throw new JevError(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const json: any = await res.json();
  const answer = json?.answers?.next_speaker;
  if (!answer || typeof answer.choice !== "string") {
    throw new JevError(`unexpected response shape: ${JSON.stringify(json).slice(0, 300)}`);
  }

  const argmax = active.find((p) => p === answer.choice);
  if (!argmax) throw new JevError(`Jev returned unknown persona "${answer.choice}"`);

  const noul = json?.answers?.needs_research;
  const researchP =
    typeof noul?.probability === "number" ? noul.probability
    : typeof noul?.noul === "number" ? noul.noul
    : 0;

  return {
    persona: argmax,
    argmax,
    confidence: typeof answer.confidence === "number" ? answer.confidence : 0,
    probabilities: answer.probabilities ?? {},
    latencyMs,
    researchP,
  };
}

/** Apply the gate without letting an unchanged transcript stall the room. */
export function resolveJevPick(pick: JevPick, lastSpeaker?: PersonaName | null, participants: PersonaName[] = PERSONA_LIST): JevPick & { silenceBreaker: boolean } {
  const silenceBreaker = pick.confidence < JEV_CONFIDENCE_GATE;
  // A new topic need not suit the old topic's favorite speaker. Empty weights
  // use sampleFrom's uniform fallback, still excluding the last speaker.
  const persona = sampleFrom(silenceBreaker ? {} : pick.probabilities, lastSpeaker, participants);
  return { ...pick, persona, silenceBreaker };
}

/** Throws JevError on API failure; the caller decides how to fall back. */
export async function pickNextSpeaker(
  transcript: string[],
  lastSpeaker?: PersonaName | null,
  participants: PersonaName[] = PERSONA_LIST
): Promise<JevPick & { silenceBreaker: boolean }> {
  return resolveJevPick(await askJev(transcript, participants), lastSpeaker, participants);
}
