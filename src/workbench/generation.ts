import path from 'node:path';
import { Store, id, clone } from './store';
import { checkSpeakerReply, WrongSpeakerError } from '../speakerTurn';
import { limitReply } from '../replyLimit';
import type { PersonaName } from '../personas/personas';

export type Provider = 'opengateway' | 'together' | 'demo';
export interface GenerationInput {
  provider: Provider; model: string; persona: PersonaName;
  messages: { role: string; content: string }[]; temperature: number; reasoning?: 'default' | 'off';
  branch?: string; revision?: string; turnId?: string;
  policy?: 'protected' | 'observe'; signal?: AbortSignal;
}
export const ENDPOINTS = {
  opengateway: 'https://apis.opengateway.ai/v1/chat/completions',
  together: 'https://api.together.ai/v1/chat/completions',
  demo: 'local:demo',
};
// Only switches probed against the live provider; an unverified parameter is never sent silently.
const REASONING_OFF: Partial<Record<Provider, object>> = { opengateway: { thinking: { type: 'disabled' } }, demo: {} };
export const reasoningSwitchVerified = (provider: Provider) => provider in REASONING_OFF;
export function defaultStore() { return new Store(process.env.ROOM_DATA_DIR || path.resolve('.room-data')); }
export async function generate(input: GenerationInput, store = defaultStore(), transport: typeof fetch = fetch) {
  if (input.reasoning === 'off' && !reasoningSwitchVerified(input.provider)) throw Error(`Turning reasoning off is not verified for ${input.provider}`);
  const attempts: string[] = [];
  const messages = clone(input.messages);
  const group = input.turnId || id();
  for (let n = 0; n < (input.policy === 'observe' ? 1 : 2); n++) {
    const attemptId = id(); attempts.push(attemptId);
    const body = { model: input.model, messages: clone(messages), temperature: input.temperature, ...(input.reasoning === 'off' ? REASONING_OFF[input.provider] : {}) };
    const request = { id: attemptId, at: new Date().toISOString(), turnId: group, branch: input.branch,
      revision: input.revision, persona: input.persona, provider: input.provider, policy: input.policy || 'protected',
      retryOf: n ? attempts[n - 1] : null, endpoint: ENDPOINTS[input.provider], body };
    store.put('attempts', attemptId, request); // Commit before any external call.
    const start = Date.now();
    let raw: string | null = null;
    let status: number | null = null;
    let parsed: any = null;
    let text = '';
    let notes: string[] = [];
    let transformations: string[] = [];
    let validation: string | null = null;
    try {
      input.signal?.throwIfAborted();
      if (input.provider === 'demo') {
        raw = JSON.stringify({ choices: [{ message: { content: `[Demo · ${input.persona}] This is a local placeholder. Choose OpenGateway or Together in Character settings to generate a real reply.` }, finish_reason: 'stop' }], demo: true });
        status = 200;
      } else {
        const key = process.env[input.provider === 'together' ? 'TOGETHER_API_KEY' : 'OPENGATEWAY_API_KEY'];
        if (!key) throw Error(`${input.provider === 'together' ? 'TOGETHER_API_KEY' : 'OPENGATEWAY_API_KEY'} is missing. Add it to .env and restart.`);
        const timeout = AbortSignal.timeout(90000);
        const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
        const response = await transport(ENDPOINTS[input.provider], { method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
        status = response.status;
        raw = await response.text();
        if (!response.ok) throw Error(`Provider returned HTTP ${status}; inspect the raw response.`);
      }
      parsed = JSON.parse(raw!);
      const full = parsed.choices?.[0]?.message?.content;
      if (typeof full !== 'string' || !full.trim()) throw Error('Provider returned no text content');
      const lines = full.split('\n');
      text = lines.filter(line => {
        const match = line.match(/^#notetomyfutureself:\s*(.*)$/i);
        if (!match) return true;
        if (match[1].trim()) notes.push(match[1].trim()); return false;
      }).join('\n').trim();
      if (notes.length) transformations.push('Removed future-memory notes from displayed reply');
      if (text !== full && !notes.length) transformations.push('Trimmed whitespace');
      try {
        const checked = checkSpeakerReply(input.persona, text);
        if (checked !== text) transformations.push('Removed assigned speaker label');
        text = checked;
      } catch (error) {
        if (!(error instanceof WrongSpeakerError)) throw error;
        validation = error.message;
        if (input.policy !== 'observe') throw error;
      }
      if (!text) throw Error('Reply is empty after processing');
      const limited = limitReply(text);
      if (limited !== text) transformations.push('Truncated to 2000 characters');
      text = limited;
      store.put('outcomes', attemptId, { id: attemptId, status: 'completed', httpStatus: status, raw, text, notes,
        validation, transformations, usage: parsed.usage ?? null, finishReason: parsed.choices?.[0]?.finish_reason ?? null,
        latencyMs: Date.now() - start, at: new Date().toISOString() });
      return { text, notes, attempts, validation };
    } catch (error: any) {
      const rejected = error instanceof WrongSpeakerError;
      store.put('outcomes', attemptId, { id: attemptId, status: input.signal?.aborted ? 'canceled' : rejected ? 'rejected' : 'failed',
        httpStatus: status, raw, code: error.name === 'TimeoutError' ? 'timeout' : null, error: error.message || String(error), validation, transformations,
        usage: parsed?.usage ?? null, finishReason: parsed?.choices?.[0]?.finish_reason ?? null,
        latencyMs: Date.now() - start, at: new Date().toISOString() });
      if (!rejected || n === 1) throw error;
      messages[messages.length - 1].content += `\n\nThe previous attempt used another participant's label. Write a fresh reply only as ${input.persona}, from your own perspective.`;
    }
  }
  throw Error('No valid reply');
}

// Display only: provider-returned reasoning is evidence, never character context.
export function reasoningOf(outcome: { raw?: string | null } | null | undefined): string | null {
  try { const value = JSON.parse(outcome?.raw || '{}').choices?.[0]?.message?.reasoning_content; return typeof value === 'string' && value.trim() ? value : null; } catch { return null; }
}
