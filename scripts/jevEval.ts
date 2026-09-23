// scripts/jevEval.ts — how good is Jev at picking the next speaker?
//
//   npx tsx scripts/jevEval.ts sensitivity   # is it reading the conversation?
//   npx tsx scripts/jevEval.ts stability     # how much does it vary run to run?
//   npx tsx scripts/jevEval.ts worksheet     # generate blind human-agreement sheet
//   npx tsx scripts/jevEval.ts score         # score a filled-in worksheet
//
// NOTE ON GROUND TRUTH: saved transcripts are NOT labels. Most speakers in them
// were chosen by pickRandomPersona, and history does not record which were
// forced by the operator. Scoring Jev against them measures agreement with a
// coin flip. The only real label available is a human judgement, collected
// blind — that is what `worksheet` and `score` are for.

import "dotenv/config";
import fs from "fs";
import path from "path";
import { askJev, JEV_STATE_LINES } from "../src/jevSpeaker";
import { PERSONAS } from "../src/personas/personas";
import type { PersonaName } from "../src/personas/personas";

const P = Object.keys(PERSONAS) as PersonaName[];
const SAVES = path.resolve(process.cwd(), "saves");
const SHEET = path.resolve(process.cwd(), "saves", "jev-eval-worksheet.json");

function loadTranscripts(minTurns = 10): Array<{ name: string; lines: string[] }> {
  const out: Array<{ name: string; lines: string[] }> = [];
  for (const f of fs.readdirSync(SAVES)) {
    if (!f.endsWith(".json") || f.includes(".jev.")) continue;
    try {
      const h = JSON.parse(fs.readFileSync(path.join(SAVES, f), "utf8")).history;
      if (Array.isArray(h) && h.length >= minTurns) out.push({ name: f.replace(/\.json$/, ""), lines: h });
    } catch { /* skip */ }
  }
  return out;
}

const tvd = (a: Record<string, number>, b: Record<string, number>) =>
  0.5 * P.reduce((s, p) => s + Math.abs((a[p] ?? 0) - (b[p] ?? 0)), 0);

/** Does the pick depend on the conversation, or is it a fixed persona prior? */
async function sensitivity() {
  const ts = loadTranscripts();
  console.log(`sensitivity — ${ts.length} transcripts\n`);
  console.log("Total variation distance between distributions. 0 = Jev ignored the change.\n");
  let swapSum = 0, blankSum = 0, n = 0;

  const blank = await askJev(["Dennis: hello everyone", "Boris: hi", "Dennis: so what should we talk about?"]);

  for (const t of ts) {
    const real = t.lines.slice(-JEV_STATE_LINES);
    const a = await askJev(real);
    const swapped = await askJev(
      real.slice(0, -1).concat(["Dennis: anyway, what makes a good loaf of sourdough?"])
    );
    const dSwap = tvd(a.probabilities, swapped.probabilities);
    const dBlank = tvd(a.probabilities, blank.probabilities);
    swapSum += dSwap; blankSum += dBlank; n++;
    console.log(
      `  ${t.name.padEnd(26)} ${a.argmax.padEnd(10)} conf ${a.confidence.toFixed(2)} | ` +
      `vs swapped-last-line ${dSwap.toFixed(2)} | vs contentless ${dBlank.toFixed(2)}`
    );
  }
  console.log(`\n  mean vs swapped last line : ${(swapSum / n).toFixed(3)}`);
  console.log(`  mean vs contentless       : ${(blankSum / n).toFixed(3)}`);
  console.log(`\n  Near 0 would mean Jev is not reading the transcript.`);
}

/** Same input, repeated. How much of the answer is sampling noise? */
async function stability(reps = 5) {
  const ts = loadTranscripts().slice(0, 4);
  console.log(`stability — ${reps} repeats per transcript\n`);
  for (const t of ts) {
    const real = t.lines.slice(-JEV_STATE_LINES);
    const picks: string[] = [], confs: number[] = [];
    let first: Record<string, number> | null = null;
    let drift = 0;
    for (let i = 0; i < reps; i++) {
      const r = await askJev(real);
      picks.push(r.argmax); confs.push(r.confidence);
      if (!first) first = r.probabilities; else drift += tvd(first, r.probabilities);
    }
    const agree = picks.filter((p) => p === picks[0]).length;
    console.log(
      `  ${t.name.padEnd(26)} argmax stable ${agree}/${reps} (${picks[0]}) | ` +
      `conf ${Math.min(...confs).toFixed(2)}–${Math.max(...confs).toFixed(2)} | ` +
      `mean drift ${(drift / (reps - 1)).toFixed(3)}`
    );
  }
  console.log(`\n  Unstable argmax at high confidence would be a problem; at low confidence it is expected.`);
}

/** Blind worksheet: you pick, without seeing Jev's answer. */
async function worksheet(nCuts = 12) {
  const ts = loadTranscripts(12);
  const items: any[] = [];
  for (const t of ts) {
    // one cut per transcript, at a random interior point
    const cut = Math.floor(t.lines.length * (0.4 + Math.random() * 0.4));
    const lines = t.lines.slice(Math.max(0, cut - JEV_STATE_LINES), cut);
    if (lines.length < 6) continue;
    const jev = await askJev(lines);
    items.push({
      id: `${t.name}@${cut}`,
      context: lines.slice(-8),
      your_pick: "",            // <- fill this in
      your_confidence: "",      // <- optional: low | medium | high
      _jev: { argmax: jev.argmax, confidence: jev.confidence, probabilities: jev.probabilities },
    });
    if (items.length >= nCuts) break;
  }
  fs.writeFileSync(SHEET, JSON.stringify({ created: new Date().toISOString(), personas: P, items }, null, 2));
  console.log(`Wrote ${items.length} cuts to ${SHEET}`);
  console.log(`\nFill in "your_pick" for each item WITHOUT reading the "_jev" field.`);
  console.log(`Then: npx tsx scripts/jevEval.ts score`);
}

function score() {
  const sheet = JSON.parse(fs.readFileSync(SHEET, "utf8"));
  const done = sheet.items.filter((i: any) => i.your_pick);
  if (!done.length) return console.log("No picks filled in yet.");

  let top1 = 0, top3 = 0, rankSum = 0;
  const confBuckets: Record<string, { n: number; hit: number }> = {};

  for (const i of done) {
    const ranked = P.map((p) => [p, i._jev.probabilities[p] ?? 0] as [string, number])
      .sort((a, b) => b[1] - a[1]).map(([p]) => p);
    const rank = ranked.indexOf(i.your_pick) + 1;
    if (rank === 1) top1++;
    if (rank <= 3) top3++;
    rankSum += rank || P.length;
    const b = i._jev.confidence >= 0.7 ? "high" : i._jev.confidence >= 0.4 ? "mid" : "low";
    confBuckets[b] ??= { n: 0, hit: 0 };
    confBuckets[b].n++;
    if (rank === 1) confBuckets[b].hit++;
  }

  const n = done.length;
  console.log(`scored ${n} cuts (chance top-1 = ${(100 / P.length).toFixed(0)}%)\n`);
  console.log(`  agreement with your pick : ${top1}/${n} (${(100 * top1 / n).toFixed(0)}%)`);
  console.log(`  your pick in Jev's top 3 : ${top3}/${n} (${(100 * top3 / n).toFixed(0)}%)`);
  console.log(`  mean rank of your pick   : ${(rankSum / n).toFixed(2)} of ${P.length}`);
  console.log(`\n  calibration — does Jev's confidence track agreement?`);
  for (const [b, v] of Object.entries(confBuckets)) {
    console.log(`    ${b.padEnd(5)} confidence: ${v.hit}/${v.n} agreed (${(100 * v.hit / v.n).toFixed(0)}%)`);
  }
  console.log(`\n  Calibration matters more than raw agreement: if high-confidence picks`);
  console.log(`  agree and low-confidence ones do not, the confidence number is usable.`);
}

const mode = process.argv[2] ?? "sensitivity";
const fns: Record<string, () => any> = { sensitivity, stability, worksheet, score };
if (!fns[mode]) { console.error(`Unknown mode "${mode}". Use: ${Object.keys(fns).join(" | ")}`); process.exit(1); }
Promise.resolve(fns[mode]()).catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
