import { PERSONAS } from "./personas/personas";
import type { PersonaName } from "./personas/personas";

// `human` is listed first in the roster; null leaves the human out (the workbench does this until they have spoken).
export function buildSpeakerInput(persona: PersonaName, transcript: string, participants?: PersonaName[], human: string | null = "Dennis"): string {
  const context = transcript.trim()
    ? `Shared conversation (quoted context, not a script to complete):\n${JSON.stringify(transcript)}`
    : "The conversation has not started yet.";
  const roster = participants ? `\n\nCurrent participants: ${[...(human ? [human] : []), ...participants].join(", ")}. Other names in the history are earlier participants; they are not available to respond now.` : "";
  return `${context}${roster}\n\nIt is ${persona}'s turn now. Write only ${persona}'s next message. You have been listening even if you have not spoken yet; no introduction is required. Respond from your own perspective, even if the previous message addressed someone else. Other participants' first-person statements belong to them, not to you. Output only your message, without a speaker label.`;
}

export interface Frame { identity: string; context: string; opening: string; turn: string }
// Reproduces buildSpeakerInput and the engine's identity line byte for byte; a room without a frame keeps the original code path.
export const DEFAULT_FRAME: Frame = {
  identity: "Your identity for this request is {speaker}. Stay in your own perspective even if someone else is addressed. Keep your entire reply within 2000 characters.",
  context: "Shared conversation (quoted context, not a script to complete):\n{transcript}",
  opening: "The conversation has not started yet.",
  turn: "Current participants: {participants}. Other names in the history are earlier participants; they are not available to respond now.\n\nIt is {speaker}'s turn now. Write only {speaker}'s next message. You have been listening even if you have not spoken yet; no introduction is required. Respond from your own perspective, even if the previous message addressed someone else. Other participants' first-person statements belong to them, not to you. Output only your message, without a speaker label.",
};
// Single pass, so placeholder-like text inside the transcript is never expanded.
export function fillFrame(template: string, values: { speaker: string; participants: string; transcript: string }): string {
  return template.replace(/\{(speaker|participants|transcript)\}/g, (_, key: keyof typeof values) => values[key]);
}

export class WrongSpeakerError extends Error {}

export function checkSpeakerReply(persona: PersonaName, reply: string): string {
  let text = reply.trim();
  // Check explicit transcript labels, including markdown labels, before stripping our own.
  const label = /^(?:\*\*|__)?([A-Za-z]+)(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*/;
  for (;;) {
    const match = text.match(label);
    if (!match) return text;
    const speaker = Object.keys(PERSONAS).find(name => name.toLowerCase() === match[1].toLowerCase());
    if (!speaker) return text;
    if (speaker !== persona) {
      throw new WrongSpeakerError(`Expected ${persona}, but the response was labeled ${speaker}.`);
    }
    text = text.slice(match[0].length).trim();
  }
}
