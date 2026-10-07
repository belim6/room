import path from 'node:path';
import { Store, id, clone } from './store';
import { checkSpeakerReply, WrongSpeakerError } from '../speakerTurn';
import { limitReply } from '../replyLimit';
import { historyConfig, assertPerspective, appendContent, type HistoryConfig } from './history';
import type { ContentPart } from './attachments';
import { LEGACY_NAMES, type Assembly } from './identity';

export type Provider = 'opengateway' | 'together' | 'demo';
// v4.1-flash-ultrafast stopped reasoning on 2026-09-30 (it now serves deepseek-flash with thinking disabled); deepseek-flash reasons by default.
export const DEFAULT_MODEL = 'deepseek/deepseek-flash';
// Local demo is for scratch instances only (ROOM_DEMO=1). Elsewhere, rooms saved with it stay editable but cannot generate.
export const demoEnabled = () => process.env.ROOM_DEMO === '1';
// Identity, label and validation roster are separate: personId attributes the attempt, labelAtDispatch is what the
// model was asked to speak as, validationRoster is what checkSpeakerReply checks. `persona` alone means legacy-v1.
export interface GenerationInput {
  provider: Provider; model: string; persona?: string; personId?: string; labelAtDispatch?: string; validationRoster?: string[];
  assemblyVersion?: Assembly; assembly?: HistoryConfig; adapterVersion?: 'perspective-1'; origin?: { item: string; revision: string };
  messages: { role: string; content: string | ContentPart[] }[]; attachments?: unknown[]; temperature: number; reasoning?: 'default' | 'off';
  branch?: string; revision?: string; turnId?: string; purpose?: 'alternative'; review?: string; candidate?: string;
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
export const readonlyMode = () => process.env.ROOM_READONLY === '1';
export function defaultStore() { return new Store(process.env.ROOM_DATA_DIR || path.resolve('.room-data'), readonlyMode()); }
export async function generate(input: GenerationInput, store = defaultStore(), transport: typeof fetch = fetch) {
  const label = input.labelAtDispatch ?? input.persona;
  if (!label) throw Error('A generation needs the label it is dispatched under');
  const assemblyVersion = input.assemblyVersion ?? 'legacy-v1', roster = assemblyVersion === 'v2' ? input.validationRoster : undefined;
  if (assemblyVersion === 'v2' && !roster?.length) throw Error('A v2 generation needs its validation roster');
  const assembly=historyConfig(assemblyVersion,input.assembly),perspective=assembly.history==='perspective';
  if(input.adapterVersion!==undefined&&(!perspective||input.adapterVersion!=='perspective-1'))throw Error('Invalid history adapter version');
  const identity = { persona: label, personId: input.personId ?? label, labelAtDispatch: label, validationRoster: roster ?? [...LEGACY_NAMES], assemblyVersion, assembly, ...(perspective?{adapterVersion:'perspective-1'}:{}), ...(input.origin ? { origin: input.origin } : {}) };
  if (input.provider === 'demo' && !demoEnabled()) throw Error(`${label} uses local demo, which is only available on instances started with ROOM_DEMO=1. Choose OpenGateway or Together in Characters.`);
  if (input.reasoning === 'off' && !reasoningSwitchVerified(input.provider)) throw Error(`Turning reasoning off is not verified for ${input.provider}`);
  const attempts: string[] = [];
  const messages = clone(input.messages);
  const group = input.turnId || id();
  for (let n = 0; n < (input.policy === 'observe' ? 1 : 2); n++) {
    const attemptId = id(); attempts.push(attemptId);
    const body = { model: input.model, messages: clone(messages), temperature: input.temperature, ...(input.reasoning === 'off' ? REASONING_OFF[input.provider] : {}) };
    const request = { id: attemptId, at: new Date().toISOString(), turnId: group, branch: input.branch,
      revision: input.revision, ...identity, provider: input.provider, policy: input.policy || 'protected',
      ...(input.purpose?{purpose:input.purpose,review:input.review,candidate:input.candidate}:{}),
      retryOf: n ? attempts[n - 1] : null, endpoint: ENDPOINTS[input.provider], body, ...(input.attachments?.length?{attachments:clone(input.attachments)}:{}) };
    if(perspective)assertPerspective(body.messages);
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
        raw = JSON.stringify({ choices: [{ message: { content: `[Demo · ${label}] This is a local placeholder. Choose OpenGateway or Together in Character settings to generate a real reply.` }, finish_reason: 'stop' }], demo: true });
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
        if (!response.ok) throw Error(`Provider returned HTTP ${status}; inspect the raw response.${messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url'))?' This request includes images. Check that this provider/model accepts image input; Room did not omit the images.':''}`);
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
        const checked = checkSpeakerReply(label, text, roster);
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
      const correction=`\n\nThe previous attempt used another participant's label. Write a fresh reply only as ${label}, from your own perspective.`;
      const last=messages[messages.length-1];
      if(perspective)appendContent(last,correction.slice(2));
      else if(typeof last.content==='string')last.content+=correction;else last.content.push({type:'text',text:correction});
    }
  }
  throw Error('No valid reply');
}

// Display only: provider-returned reasoning is evidence, never character context.
export function reasoningOf(outcome: { raw?: string | null } | null | undefined): string | null {
  try { const value = JSON.parse(outcome?.raw || '{}').choices?.[0]?.message?.reasoning_content; return typeof value === 'string' && value.trim() ? value : null; } catch { return null; }
}
