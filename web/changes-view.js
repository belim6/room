/* Derived views only. No diff or research annotation is sent to a model. */
const RoomChanges=(()=>{
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const titles={system:'Shared instructions',prompt:'Personality instructions',memory:'Retained memory',participants:'Participants',human:'Human name',shadow:'Jev shadow',policy:'Identity checks',reasoning:'Reasoning',frame:'Harness framing'};
  function groups(settings){const result=[];for(const s of settings){const prior=['model','provider','reasoning'].includes(s.field)&&result.find(r=>r.field===s.field&&r.before===s.before&&r.after===s.after);if(prior)prior.characters.push(s.character);else result.push({...s,characters:s.character?[s.character]:[]});}return result;}
  function badges(changes){
    if(!changes)return [];
    const result=groups(changes.settings).map(s=>{
      if(s.field==='system'){const add=s.diff?.filter(l=>l.op==='add').length||0,del=s.diff?.filter(l=>l.op==='del').length||0;return s.diff?`rules ${del?'−'+del:''}${add?' +'+add:''} line${Math.max(add,del)===1?'':'s'}`:'rules edited';}
      return `${s.characters.length===1?s.characters[0]+' ':''}${s.field} ${['model','provider','reasoning'].includes(s.field)?'changed':'edited'}${s.characters.length>1?' ×'+s.characters.length:''}`;
    });
    const c=changes.conversation,total=Object.values(c.appended).reduce((a,b)=>a+b,0);
    if(total)result.push(`+${total} message${total===1?'':'s'}`);
    if(c.edited.length)result.push(`retcon: ${c.edited.length} edited`);
    if(c.removed.length)result.push(`${c.removed.length} removed`);
    if(c.inserted.length)result.push(`${c.inserted.length} inserted`);
    if(c.reordered)result.push('messages reordered');return result;
  }
  function diff(lines){
    const line=l=>`<div class="diff-line diff-${l.op}"><span aria-hidden="true">${l.op==='add'?'+':l.op==='del'?'−':' '}</span><span>${esc(l.text)||' '}</span></div>`;
    let html='';for(let i=0;i<lines.length;){if(lines[i].op!=='same'){html+=line(lines[i++]);continue;}let end=i;while(end<lines.length&&lines[end].op==='same')end++;const run=lines.slice(i,end);html+=run.length>3?`<details class="diff-unchanged"><summary>… ${run.length} unchanged lines …</summary>${run.map(line).join('')}</details>`:run.map(line).join('');i=end;}return `<div class="line-diff">${html}</div>`;
  }
  function render(changes){
    if(!changes)return '<p class="muted">This is an original conversation; it has no fork to compare against.</p>';
    const settings=groups(changes.settings).map(s=>`<section class="change-field"><h3>${esc(s.characters.length===1?s.characters[0]+' · ':'')}${esc(titles[s.field]||s.field)}${s.characters.length>1?' ('+s.characters.length+' characters)':''}</h3>${s.diff?diff(s.diff):s.field==='participants'?`<p>Added: ${esc(s.after.filter(n=>!s.before.includes(n)).join(', ')||'none')}<br>Removed: ${esc(s.before.filter(n=>!s.after.includes(n)).join(', ')||'none')}</p>`:`<p class="change-values"><del>${esc(typeof s.before==='object'?JSON.stringify(s.before):s.before)}</del> → <ins>${esc(typeof s.after==='object'?JSON.stringify(s.after):s.after)}</ins></p>`}</section>`).join('');
    const c=changes.conversation;return settings+(Object.keys(c.appended).length?`<p>Appended: ${Object.entries(c.appended).map(([k,v])=>esc(v+' '+k)).join(' · ')}</p>`:'')+['edited','removed','inserted'].filter(k=>c[k].length).map(k=>`<details><summary>${c[k].length} message${c[k].length===1?'':'s'} ${k}</summary><p class="muted">Message IDs</p>${c[k].map(v=>`<code>${esc(v)}</code>`).join('<br>')}</details>`).join('')+(c.reordered?'<p>Message order changed.</p>':'')||'<p class="muted">No changes from the comparison state.</p>';
  }
  return {badges,diff,render};
})();
if(typeof module!=='undefined')module.exports=RoomChanges;
