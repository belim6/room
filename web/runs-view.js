/* Pure run-driving and polling helpers, shared by the browser and the tests. */
const RoomRuns=(()=>{
  // Drive a run one index at a time until the server reports a terminal status or the caller stops.
  // No client-side attempt cap: turns detached by interjections don't count, and only the server decides when the run ends.
  async function drive(advance,onTurn,stopped){
    let out=null;
    for(let n=1;!stopped();n++){out=await advance(n);await onTurn(out);if(out.run.status!=='running')break;}
    return out;
  }
  // Poll while a run this tab isn't driving is visible; back off after failures (2 s, 4 s, … up to 30 s).
  const shouldPoll=(visible,driving)=>visible.some(r=>r&&r.run&&!driving(r.branch.id));
  const pollDelay=failures=>Math.min(30000,2000*2**Math.max(0,failures));
  return {drive,shouldPoll,pollDelay};
})();
if(typeof module!=='undefined')module.exports=RoomRuns;
