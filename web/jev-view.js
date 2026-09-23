/* Shared by the browser and the renderer regression tests. */
(function(root) {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
  const percent = value => valid(value) ? new Intl.NumberFormat('en',{style:'percent',maximumFractionDigits:1}).format(value) : 'Unavailable';
  function render(message, observations = [], selections = []) {
    const observation = message.turnId && observations.find(j => j.turnId === message.turnId);
    if (!observation) return '<div class="jev-empty">No Jev observation recorded for this message.</div>';
    const selection = selections.find(s => s.id === message.turnId);
    const method = {forced:'your pick',locked:'locked for this run',random:'random',jev:'Jev selection'}[selection?.method] || selection?.method;
    const speaker = selection?.chosen || message.speaker;
    const heading = `<div class="jev-heading"><strong>Jev shadow</strong><span>Before this reply</span></div><div class="jev-actual">Actually selected: <strong>${esc(speaker)}</strong>${method?' · '+esc(method):''}</div>`;
    const edited = message.source === 'edited' ? '<div class="jev-caveat">This message was edited. The observation belongs to the original turn.</div>' : '';
    const outcome = observation.outcome;
    if (!outcome) return `<section class="jev-card">${heading}${edited}<div class="jev-state">Observation pending…</div></section>`;
    if (outcome.status !== 'completed') return `<section class="jev-card">${heading}${edited}<div class="jev-state">${outcome.status==='interrupted'?'Observation interrupted':'Observation failed'}${outcome.error?' · '+esc(outcome.error):''}</div></section>`;
    const choice = outcome.answers?.next_speaker || {}, research = outcome.answers?.needs_research?.noul;
    const probabilities = Object.entries(choice.probabilities || {}).filter(([,p])=>valid(p)).sort((a,b)=>b[1]-a[1]);
    const pick = typeof choice.choice === 'string' ? choice.choice : null;
    const rows = probabilities.map(([name,p])=>`<div class="jev-probability ${name===pick?'jev-pick':''}"><span>${esc(name)}${name===pick?'<small>Jev pick</small>':''}</span><meter min="0" max="1" value="${p}" aria-label="${esc(name)} speaker probability">${percent(p)}</meter><strong>${percent(p)}</strong></div>`).join('');
    return `<section class="jev-card">${heading}${edited}<div class="jev-summary"><span>Jev would pick <strong>${esc(pick || 'Unavailable')}</strong></span><span title="Confidence reported by Jev, separate from the speaker probabilities below.">Jev confidence <strong>${percent(choice.confidence)}</strong></span></div><div class="jev-probabilities" aria-label="Speaker probabilities">${rows || '<div class="jev-state">Speaker probabilities unavailable.</div>'}</div><div class="jev-research"><span>External research needed</span><strong>${percent(research)}</strong></div></section>`;
  }
  const api = { render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RoomJev = api;
})(typeof window !== 'undefined' ? window : globalThis);
