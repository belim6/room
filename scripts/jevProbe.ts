// scripts/jevProbe.ts — one real Jev call against a saved transcript.
// Usage: npx tsx scripts/jevProbe.ts [saveName] [lines]
import "dotenv/config";
import fs from "fs";
import path from "path";
import { askJev, sampleFrom, PERSONA_CRITERIA, JEV_CONFIDENCE_GATE } from "../src/jevSpeaker";

const saveName = process.argv[2] ?? "antichrist_v2";
const nLines = Number(process.argv[3] ?? 20);

const file = path.resolve(process.cwd(), "saves", `${saveName}.json`);
if (!fs.existsSync(file)) {
  console.error(`No such save: ${file}`);
  process.exit(1);
}

const snap = JSON.parse(fs.readFileSync(file, "utf8"));
const history: string[] = snap.history ?? snap.HISTORY ?? [];
if (!history.length) {
  console.error(`Save "${saveName}" has no history array. Keys: ${Object.keys(snap).join(", ")}`);
  process.exit(1);
}

const transcript = history.slice(-nLines);

(async () => {
  console.log("=== criteria sent to Jev ===");
  for (const [p, c] of Object.entries(PERSONA_CRITERIA)) console.log(`  ${p.padEnd(10)} ${c.what}`);

  console.log(`\n=== last ${transcript.length} transcript lines (${saveName}) ===`);
  for (const l of transcript) console.log("  " + l.slice(0, 110));

  const pick = await askJev(transcript);

  console.log(`\n=== Jev ===`);
  console.log(`  argmax:     ${pick.argmax}`);
  console.log(`  confidence: ${pick.confidence.toFixed(3)}  (gate ${JEV_CONFIDENCE_GATE} → ${pick.confidence < JEV_CONFIDENCE_GATE ? "SILENCE" : "speak"})`);
  console.log(`  latency:    ${pick.latencyMs}ms`);
  console.log(`  distribution:`);
  Object.entries(pick.probabilities)
    .sort((a: any, b: any) => b[1] - a[1])
    .forEach(([p, v]: any) => console.log(`    ${p.padEnd(10)} ${v.toFixed(4)}  ${"█".repeat(Math.round(v * 50))}`));

  const tally: Record<string, number> = {};
  for (let i = 0; i < 1000; i++) {
    const s = sampleFrom(pick.probabilities, null);
    tally[s] = (tally[s] ?? 0) + 1;
  }
  console.log(`\n  weighted sampling, 1000 draws:`);
  Object.entries(tally).sort((a, b) => b[1] - a[1]).forEach(([p, n]) => console.log(`    ${p.padEnd(10)} ${n}`));
})().catch((e) => { console.error("\nPROBE FAILED:", e.message); process.exit(1); });
