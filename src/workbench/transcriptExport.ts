import type { State } from './engine';
import { DEFAULT_FRAME } from '../speakerTurn';
import { labelOf } from './identity';
import { scopeTag } from './locations';
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
// A standalone print document: no research records, credentials or provider responses.
export function transcriptExport(name:string,state:State) {
  const title=name.replace(/(?: · (?:compare copy|history retcon|retcon))+$/g,'');
  const block=(heading:string,text:string)=>text.trim()?`<section class="prompt"><h3>${escape(heading)}</h3><div class="copy">${escape(text)}</div></section>`:'';
  const frame=state.frame||DEFAULT_FRAME;
  const characters=state.participants.map(person=>{const c=state.characters[person];return `<section class="character"><h2>${escape(labelOf(state,person))}</h2>${block('Situation in this room',c.situation||'')}${block('Personality instructions',c.prompt)}${block('Retained memory',c.memory)}${(c.additions||[]).map((a,i)=>block('Improv addition '+(i+1),a.text)).join('')}${!c.prompt.trim()&&!c.memory.trim()?'<p class="muted">No personality instructions or retained memory.</p>':''}</section>`;}).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} — Room transcript</title><link rel="stylesheet" href="/transcript.css"><script src="/transcript.js" defer></script></head><body>
  <nav class="print-tools"><span>Transcript &amp; current prompts</span><button id="print">Save as PDF / Print</button><p>In the print dialog, choose Save as PDF. Turn off browser headers and footers for a clean document.</p></nav>
  <main><header><div class="eyebrow">THE ROOM / TRANSCRIPT</div><h1>${escape(title)}</h1><p class="meta">${state.messages.length} messages · ${state.participants.length} active characters</p></header>
  <section class="transcript" aria-label="Transcript">${state.messages.map((m,i)=>`<article class="message"><h2><span class="number">${String(i+1).padStart(2,'0')}</span>${escape(m.speaker)}${scopeTag(m)?` <span class="scope">${escape(scopeTag(m))}</span>`:''}</h2><div class="copy">${escape(m.text)}</div>${m.attachments?.length?`<p class="muted attachment">${m.attachments.length} attachment(s); file contents are omitted from this text export.</p>`:''}</article>`).join('')||'<p class="muted">No messages yet.</p>'}</section>
  <section class="prompts"><div class="eyebrow">CONTEXT / CURRENT SETTINGS</div><h1>System prompts</h1><p class="intro">These are the current settings for this conversation. Earlier replies may have used different prompts. Historical requests remain in the research JSON export.</p>
  <h2>Shared room instructions</h2><div class="copy">${escape(state.system)||'No shared instructions.'}</div>
  ${characters}<section class="character"><h2>Harness framing</h2>${block('Identity instructions',frame.identity)}${block('Conversation template',frame.context)}${block('Opening instructions',frame.opening)}${block('Turn instructions',frame.turn)}${Object.values(frame).every(v=>!v.trim())?'<p class="muted">No harness framing.</p>':''}</section></section>
  <footer>THE ROOM · ${escape(title)}</footer></main></body></html>`;
}
