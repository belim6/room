// scripts/researchProbe.ts — verify the Codex invocation before it goes in the room.
// Usage: npx tsx scripts/researchProbe.ts "your question here"
import "dotenv/config";
import { askCodex, researchContext, CODEX_BIN, RESEARCH_TIMEOUT_MS } from "../src/research";

const query = process.argv.slice(2).join(" ") || "What is the current version of the Codex CLI?";

(async () => {
  console.log(`bin: ${CODEX_BIN} | timeout: ${RESEARCH_TIMEOUT_MS}ms`);
  console.log(`query: ${query}\n`);
  const r = await askCodex(query);
  console.log(`--- answer (${r.answer.length} chars, ${r.latencyMs}ms) ---`);
  console.log(r.answer);
  console.log(`\n--- sources (${r.sources.length}) ---`);
  r.sources.forEach((s) => console.log("  " + s));
  console.log(`\n--- what the persona would actually receive ---`);
  console.log(researchContext(r));
})().catch((e) => { console.error("PROBE FAILED:", e.message); process.exit(1); });
