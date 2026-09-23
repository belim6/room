// src/discord.ts
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { Client, GatewayIntentBits, Message } from "discord.js";

import {
  initAssignments,
  getAllAssignments,
  exportAssignments,
  importAssignments,
  shuffleAssignments,
  setPersonaMode,
  getPersonaMode,
  setAssignment,
  MODELS,
} from "./modelRouter";

import { PERSONAS } from "./personas/personas";
import type { PersonaName } from "./personas/personas";

import { sendViaWebhook } from "./webhooks";
import { respondAs } from "./modelRouter";

import { saveSnapshot, loadSnapshot } from "./snapshot";
import { dumpAllPersonaMemory, exportPersonaMemory, importPersonaMemory } from "./personaState";
import { askJev, resolveJevPick, JevError, JEV_CONFIDENCE_GATE , JEV_RESEARCH_THRESHOLD, JEV_HANDOVER_THRESHOLD, JEV_HANDOVER_STREAK } from "./jevSpeaker";
import { askCodex, researchContext, ResearchError, RESEARCH_TIMEOUT_MS } from "./research";
import { recordTurn, resetTurns, formatReport, saveTurnsFor, loadTurnsFor, turnCount } from "./jevLog";
console.log(">>> discord.ts reached top <<<", new Date().toISOString());
// ---- Known model keys (for command validation + /models UX only) ----
console.log("TOP", Date.now());

import { parseParticipants, validateParticipants } from "./participants";

const KNOWN_MODELS = MODELS;

let DEBUG_PROMPTS = false;

// ---- Simple in-memory conversation history ----
const HISTORY: string[] = [];
const MAX_HISTORY = 40;
const USER_NAME = "Dennis";

function pushHistory(line: string) {
  HISTORY.push(line);
  if (HISTORY.length > MAX_HISTORY) HISTORY.shift();
}

function buildPrompt(extra?: string) {
  const base = HISTORY.join("\n");
  return extra ? `${base}\n${extra}` : base;
}

// "#zerian" -> "Zerian"
function normalizePersonaTag(rawTag: string): PersonaName {
  return (
    rawTag.slice(1).charAt(0).toUpperCase() + rawTag.slice(2).toLowerCase()
  ) as PersonaName;
}

const PERSONA_LIST = Object.keys(PERSONAS) as PersonaName[];
let activeParticipants: PersonaName[] = [...PERSONA_LIST];
let lastSpeaker: PersonaName | null = null;

let lockedPersona: PersonaName | null = null;

// ---- Speaker selection mode ----
// random = uniform pick (excluding last speaker); jev = TypeSafe Choice over personas.
// Explicit "#persona" and /toggle locks bypass both.
// "warmup" = you seed the room; Jev shadows every turn and takes over once the
// conversation has brewed enough for it to be confident. "jev" = Jev routes now.
type SelectionMode = "random" | "jev" | "warmup";
let selectionMode: SelectionMode = "random";
let confidentStreak = 0;

// ---- Web research (Codex CLI) ----
// "auto"  = Jev's needs_research Noul decides, per turn
// "off"   = only an explicit ?search marker triggers a lookup
// "never" = no lookups at all
type ResearchMode = "auto" | "off" | "never";
let researchMode: ResearchMode = "off";
const RESEARCH_MARKER = /(^|\s)\?search\b/i;


function fmtLock() {
  return lockedPersona ? `🔒 Locked to **${lockedPersona}**` : "🔓 Not locked";
}

console.log("[discord.ts] loaded", new Date().toISOString());
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
process.on("uncaughtException", (e) => console.error("[uncaughtException]", e));
function pickRandomPersona(exclude?: PersonaName | null): PersonaName {

  if (activeParticipants.length === 1) return activeParticipants[0];

  const candidates = exclude
    ? activeParticipants.filter((p) => p !== exclude)
    : [...activeParticipants];

  const pool = candidates.length ? candidates : activeParticipants;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---- prompt debug helpers ----
function clip(s: string, max = 2400) {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + `\n… [clipped ${s.length - max} chars]` : s;
}

function logPrompt(turnId: string, persona: string, model: string, system: string, user: string) {
  console.log(`\n===== TURN ${turnId} | ${persona} | ${model} =====`);
  console.log(`--- SYSTEM (${system.length} chars) ---\n${clip(system)}`);
  console.log(`--- USER (${user.length} chars) ---\n${clip(user)}`);
  console.log("===== END TURN =====\n");
}
// ---- Discord client ----
console.log("[boot] before client");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    // GatewayIntentBits.DirectMessages, // enable only if you really need DMs
  ],
});

console.log("[boot] after client");

// Node-level safety nets (ONLY ONCE)
process.on("unhandledRejection", (e) => console.error("[node] unhandledRejection", e));
process.on("uncaughtException", (e) => console.error("[node] uncaughtException", e));

// Discord-level safety nets (ONLY ONCE)
client.on("error", (e) => console.error("[discord] client error", e));
client.on("shardError", (e) => console.error("[discord] shard error", e));
client.on("shardReady", (id) => console.log("[discord shardReady]", id));
client.on("shardDisconnect", (event, id) =>
  console.log("[discord shardDisconnect]", id, event?.reason)
);
client.on("shardReconnecting", (id) => console.log("[discord shardReconnecting]", id));

// Optional: keep OFF unless actively debugging (can include sensitive info)
const DEBUG_DISCORD = false;
if (DEBUG_DISCORD) {
  client.on("debug", (m) => console.log("[discord debug]", m));
  client.on("warn", (m) => console.warn("[discord warn]", m));
}

const readyAlarm = setTimeout(
  () => console.error("[boot] still no ready after 15s"),
  15000
);

function onClientReady() {
  clearTimeout(readyAlarm);

  console.log("🤖 Logged in as", client.user?.tag);
  console.log(`Mode: ${getPersonaMode()}`);
  console.log("Personas:", PERSONA_LIST.join(", "));
  console.log("=== Persona → Model mapping ===");
  for (const { persona, modelKey, modelId } of getAllAssignments()) {
    console.log(`${persona.padEnd(10)}  ${String(modelKey).padEnd(14)}  ${modelId}`);
  }
  console.log("==============================");
}

client.once("clientReady", () => {
  try {
    onClientReady();
  } catch (e) {
    console.error("[clientReady handler crashed]", e);
  }
});

async function main() {
  if (!process.env.OPENGATEWAY_API_KEY) {
    console.error("[boot] OPENGATEWAY_API_KEY missing: add it to .env and restart the room.");
    process.exit(1);
  }
  initAssignments();
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.error("[boot] DISCORD_BOT_TOKEN missing (check .env + var name).");
    process.exit(1);
  }

  console.log("[boot] calling login…");
  await client.login(token);
}

main().catch((e) => {
  console.error("[boot] fatal", e);
  process.exit(1);
});


// --- dedupe guard (prevents accidental double-processing) ---
const seenMsgIds = new Set<string>();

client.on("messageCreate", async (message: Message) => {
  // ignore bots + webhooks (prevents echo loops)
  if (message.author.bot) return;
  if (message.webhookId) return;

  // idempotency guard (some clients can deliver duplicates)
  if (seenMsgIds.has(message.id)) return;
  seenMsgIds.add(message.id);
  setTimeout(() => seenMsgIds.delete(message.id), 60_000);

  const content = (message.content || "").trim();
  if (!content) return;

  const isDot = content === ".";
  const isCommand = content.startsWith("/");

  // ---- Commands (never stored, never passed to personas) ----
  if (/^\/participants(?:\s|$)/i.test(content)) {
    const args = content.slice("/participants".length).trim();
    if (args) {
      try {
        activeParticipants = parseParticipants(args);
        if (lockedPersona && !activeParticipants.includes(lockedPersona)) lockedPersona = null;
      } catch (error) {
        await message.reply(error instanceof Error ? error.message : String(error));
        return;
      }
    }
    await message.reply(`**Participants:** ${activeParticipants.join(", ")}\nChoose: /participants boris elorin velric\nRestore everyone: /participants all\n${fmtLock()}`);
    return;
  }

  if (content === "/who") {
    await message.reply(`Last speaker: ${lastSpeaker ?? "(none)"}`);
    return;
  }

  if (content === "/shuffle") {
    shuffleAssignments();
    await message.react("🔀").catch(() => {});
    return;
  }

  if (content.startsWith("/toggle")) {
  const parts = content.trim().split(/\s+/);
  const arg = (parts[1] || "").trim();

  if (!arg) {
    await message.reply(`Usage: /toggle <persona> | /toggle off\n${fmtLock()}`);
    return;
  }

  if (arg.toLowerCase() === "off") {
    lockedPersona = null;
    await message.reply(`🔓 Lock disabled.`);
    return;
  }

  const persona =
    (arg.charAt(0).toUpperCase() + arg.slice(1).toLowerCase()) as PersonaName;

  if (!PERSONA_LIST.includes(persona)) {
    await message.reply(
      `Unknown persona "${arg}". Available: ${PERSONA_LIST.join(", ")}`
    );
    return;
  }

  if (!activeParticipants.includes(persona)) {
    await message.reply(`${persona} is not participating. Use /participants to change the group.`);
    return;
  }
  lockedPersona = persona;
  await message.reply(`🔒 Locked to **${lockedPersona}**.`);
  return;
}
  if (content === "/models") {
    const lines = Object.entries(KNOWN_MODELS).map(([k, v]) => `• \`${k}\` → ${v}`);
    await message.reply(`**Available models**\n\n${lines.join("\n")}`);
    return;
  }

  if (content === "/assignments") {
    const rows = getAllAssignments();
    const lines = rows.map(({ persona, modelKey, modelId }) =>
      `• **${persona}** → \`${String(modelKey)}\`\n  ${modelId}`
    );
    await message.reply(`**Current persona → model assignments**\n\n${lines.join("\n")}`);
    return;
  }

  if (content === "/debug on") {
    DEBUG_PROMPTS = true;
    await message.reply("Debug prompts: ON (printed to terminal)");
    return;
  }

  if (content === "/debug off") {
    DEBUG_PROMPTS = false;
    await message.reply("Debug prompts: OFF");
    return;
  }

  // /mode manual | emergent
  if (content.startsWith("/jevreport")) {
    if (content.split(/\s+/)[1] === "reset") {
      resetTurns();
      await message.reply("Jev report counters reset (the jsonl log is untouched).");
      return;
    }
    await message.reply(formatReport());
    return;
  }

  if (content.startsWith("/research")) {
    const mode = (content.split(/\s+/)[1] || "").toLowerCase();
    if (mode === "auto" || mode === "off" || mode === "never") {
      researchMode = mode;
      await message.reply(
        `Web research: **${researchMode}**` +
          (researchMode === "auto" ? ` (Jev decides, threshold ${JEV_RESEARCH_THRESHOLD})` : "") +
          (researchMode === "off" ? " (only `?search` in a message triggers a lookup)" : "")
      );
    } else {
      await message.reply(
        `Usage: /research auto | off | never\nCurrently: **${researchMode}**\n\`auto\` = Jev decides per turn · \`off\` = only \`?search\` · \`never\` = disabled`
      );
    }
    return;
  }

  if (content.startsWith("/select")) {
    const mode = (content.split(/\s+/)[1] || "").toLowerCase();
    if (mode === "random" || mode === "jev" || mode === "warmup") {
      selectionMode = mode;
      confidentStreak = 0;
      await message.reply(
        `Speaker selection: **${selectionMode}**` +
          (selectionMode === "jev" ? ` (topic change below confidence ${JEV_CONFIDENCE_GATE})` : "")
      );
    } else {
      await message.reply(
        `Usage: /select random | /select jev | /select warmup\nCurrently: **${selectionMode}**\n\`warmup\` = you pick with #name (random otherwise) while Jev watches; it takes over after ${JEV_HANDOVER_STREAK} consecutive calls above ${JEV_HANDOVER_THRESHOLD} confidence.`
      );
    }
    return;
  }

  if (content.startsWith("/mode")) {
    const parts = content.split(/\s+/);
    const mode = (parts[1] || "").toLowerCase();
    if (mode === "manual" || mode === "emergent") {
      setPersonaMode(mode as any);
      await message.reply(`Persona mode set to: ${getPersonaMode()}`);
    } else {
      await message.reply("Usage: /mode manual | /mode emergent");
    }
    return;
  }

  // Alias commands
  if (content === "/manual") {
    setPersonaMode("manual");
    await message.reply(`Persona mode set to: ${getPersonaMode()}`);
    return;
  }

  if (content === "/emergent") {
    setPersonaMode("emergent");
    await message.reply(`Persona mode set to: ${getPersonaMode()}`);
    return;
  }

  // reset history (like restarting the program)
  if (content === "/reset") {
    HISTORY.length = 0;
    lastSpeaker = null;
    const dropped = turnCount();
    resetTurns();
    await message.reply(
      `Room state reset (history cleared${dropped ? `, ${dropped} unsaved Jev decision(s) discarded` : ""}).`
    );
    return;
  }

  if (content === "/prompts") {
    await message.react("📜").catch(() => {});
    console.log(dumpAllPersonaMemory(PERSONA_LIST));
    return;
  }

  if (content.startsWith("/save ")) {
    const id = content.slice("/save ".length).trim();
    if (!id) {
      await message.react("❓").catch(() => {});
      return;
    }
    try {
      await saveSnapshot({
        id,
        savedAt: new Date().toISOString(),
        history: HISTORY,
        assignments: exportAssignments(),
        lastSpeaker,
        personaMemory: exportPersonaMemory(),
        participants: [...activeParticipants],
      });
      const n = saveTurnsFor(id);
      await message.react("💾").catch(() => {});
      if (n) console.log(`[jevLog] wrote ${n} decision(s) to saves/${id}.jev.jsonl`);
    } catch (e) {
      console.error("Save error:", e);
      await message.react("⚠️").catch(() => {});
    }
    return;
  }

  if (content.startsWith("/load ")) {
    const id = content.slice("/load ".length).trim();
    if (!id) {
      await message.react("❓").catch(() => {});
      return;
    }
    try {
      const snap = await loadSnapshot(id);
      const restoredParticipants = snap.participants === undefined
        ? [...PERSONA_LIST]
        : validateParticipants(snap.participants);
      activeParticipants = restoredParticipants;
      if (lockedPersona && !activeParticipants.includes(lockedPersona)) lockedPersona = null;

      HISTORY.length = 0;
      HISTORY.push(...snap.history);

      importAssignments(snap.assignments);
      importPersonaMemory(snap.personaMemory);

      lastSpeaker = snap.lastSpeaker ?? null;

      const n = loadTurnsFor(id);
      console.log(`[jevLog] restored ${n} decision(s) from saves/${id}.jev.jsonl`);

      await message.react("📥").catch(() => {});
    } catch (e) {
      console.error("Load error:", e);
      await message.react("⚠️").catch(() => {});
    }
    return;
  }

  // /append <persona|all> <modelKey>
  if (content.startsWith("/append ")) {
    const parts = content.trim().split(/\s+/);
    const target = parts[1];   // persona OR "all"
    const modelKey = parts[2]; // model key

    if (!target || !modelKey) {
      await message.reply(
        "Usage:\n" +
          "• /append <persona> <modelKey>\n" +
          "• /append all <modelKey>\n\n" +
          "Examples:\n" +
          "• /append boris kimi\n" +
          "• /append all kimi"
      );
      return;
    }

    if (!(modelKey in KNOWN_MODELS)) {
      await message.reply(
        `Unknown modelKey "${modelKey}". Available: ${Object.keys(KNOWN_MODELS).join(", ")}`
      );
      return;
    }

    if (target.toLowerCase() === "all") {
      for (const p of PERSONA_LIST) {
        setAssignment(p, modelKey as any);
      }
      await message.reply(`Assigned **all personas** → \`${modelKey}\``);
      return;
    }

    const persona =
      (target.charAt(0).toUpperCase() + target.slice(1).toLowerCase()) as PersonaName;

    if (!PERSONA_LIST.includes(persona)) {
      await message.reply(
        `Unknown persona "${target}". Available: ${PERSONA_LIST.join(", ")}`
      );
      return;
    }

    setAssignment(persona, modelKey as any);
    await message.reply(`Assigned **${persona}** → \`${modelKey}\``);
    return;
  }

  if (isCommand) return; // ignore any other /something

  // ---- reply context (not stored in history) ----
  let replyContext = "";
  if (message.reference?.messageId) {
    try {
      const ref = await message.channel.messages.fetch(message.reference.messageId);
      const refText = (ref.content || "").trim().slice(0, 1200);
      if (refText) {
        replyContext = `\n\n[You are replying to this message]\n${refText}\n[/end]`;
      }
    } catch {
      // ignore
    }
  }

  // ---- Detect explicit persona call ----
  let forcedPersona: PersonaName | null = null;
  let cleanedUserText: string | null = null;
  let isBareNameCall = false;

  if (content.startsWith("#")) {
    const [rawTag, ...rest] = content.split(" ");
    const personaName = normalizePersonaTag(rawTag);

    if (PERSONA_LIST.includes(personaName)) {
      forcedPersona = personaName;
      const prompt = rest.join(" ").trim();
      if (!prompt) {
        isBareNameCall = true; // "#velric"
        cleanedUserText = null;
      } else {
        cleanedUserText = prompt; // "#velric hi" -> "hi"
      }
    } else {
      cleanedUserText = content; // unknown tag treated as normal text
    }
  } else if (!isDot) {
    cleanedUserText = content;
  }

  if (forcedPersona && !activeParticipants.includes(forcedPersona)) {
    await message.reply(`${forcedPersona} is not participating. Use /participants to change the group.`);
    return;
  }

  // ---- Explicit research marker ("?search" anywhere in the message) ----
  let forceResearch = false;
  if (cleanedUserText && RESEARCH_MARKER.test(cleanedUserText)) {
    forceResearch = researchMode !== "never";
    cleanedUserText = cleanedUserText.replace(RESEARCH_MARKER, " ").replace(/\s+/g, " ").trim();
    if (!cleanedUserText) cleanedUserText = null;
  }

  // ---- History rules ----
  // - do NOT store: ".", any "/...", and bare "#name"
  if (!isDot && !isBareNameCall && cleanedUserText) {
    pushHistory(`${USER_NAME}: ${cleanedUserText}`);
  }

  // ---- Choose persona ----
  let chosen: PersonaName;
  let silenceBreaker = false;
  let jevResearchP = 0;
  const explicit = forcedPersona ?? lockedPersona;

  if (explicit) {
    chosen = explicit;
  } else if (selectionMode === "warmup") {
    // You steer. Jev still evaluates every turn so we can see when the room has
    // brewed, but its pick is not used and it cannot trigger a topic change.
    try {
      const pick = await askJev(HISTORY, [...activeParticipants]);
      jevResearchP = pick.researchP;
      const confident = pick.confidence >= JEV_HANDOVER_THRESHOLD;
      confidentStreak = confident ? confidentStreak + 1 : 0;
      console.log(
        `[jev:warmup] shadow | would pick ${pick.argmax} | conf ${pick.confidence.toFixed(2)} | streak ${confidentStreak}/${JEV_HANDOVER_STREAK} | ${pick.latencyMs}ms`
      );

      if (confidentStreak >= JEV_HANDOVER_STREAK) {
        selectionMode = "jev";
        confidentStreak = 0;
        console.log("[jev:warmup] handover \u2014 Jev is now selecting speakers");
        await message
          .reply("🎙️ The room has warmed up — Jev is choosing speakers from here. `/select warmup` to take it back.")
          .catch(() => {});
      }
    } catch (err) {
      console.error("[jev:warmup] shadow call failed:", err instanceof JevError ? err.message : err);
    }
    chosen = pickRandomPersona(lastSpeaker);
  } else if (selectionMode === "jev") {
    try {
      const eligible = [...activeParticipants];
      const pick = await askJev(HISTORY, eligible);
      const decision = resolveJevPick(pick, lastSpeaker, eligible);
      silenceBreaker = decision.silenceBreaker;
      const sampled = decision.persona;

      const dist = Object.entries(pick.probabilities)
        .sort((a, b) => b[1] - a[1])
        .map(([p, v]) => `${p} ${(v * 100).toFixed(0)}%`)
        .join(", ");
      console.log(
        `[jev] ${silenceBreaker ? `TOPIC CHANGE: ${sampled}` : sampled} | argmax ${pick.argmax} | conf ${pick.confidence.toFixed(2)} | ${pick.latencyMs}ms | ${dist}`
      );

      recordTurn({
        chosen: sampled,
        argmax: pick.argmax,
        confidence: pick.confidence,
        latencyMs: pick.latencyMs,
        probabilities: pick.probabilities,
        silenced: false,
        silenceBreaker,
      });

      jevResearchP = pick.researchP;
      chosen = sampled;
    } catch (err) {
      console.error("[jev] falling back to random:", err instanceof JevError ? err.message : err);
      chosen = pickRandomPersona(lastSpeaker);
    }
  } else {
    chosen = pickRandomPersona(lastSpeaker);
  }
  // A participant may be removed while an API call is running.
  if (!activeParticipants.includes(chosen)) return;
  // ---- Optional web lookup, before the persona speaks ----
  let research: string | undefined;
  const wantsResearch =
    researchMode !== "never" &&
    (forceResearch || (researchMode === "auto" && jevResearchP >= JEV_RESEARCH_THRESHOLD));

  if (wantsResearch) {
    const query = HISTORY.slice(-6).join("\n");
    const why = forceResearch ? "forced" : `noul ${jevResearchP.toFixed(2)}`;
    console.log(`[research] ${chosen} | ${why} | querying codex (max ${RESEARCH_TIMEOUT_MS}ms)`);
    try {
      await message.react("\u{1F50D}").catch(() => {});
      const r = await askCodex(query);
      research = researchContext(r) || undefined;
      console.log(
        `[research] ${r.latencyMs}ms | ${r.answer.length} chars | ${r.sources.length} source(s)` +
          (r.sources.length ? ` | ${r.sources.slice(0, 3).join(" ")}` : "")
      );
    } catch (err) {
      console.error("[research] skipped:", err instanceof ResearchError ? err.message : err);
    }
  }

  // ---- Build model input ----
  let stageInput = buildPrompt(replyContext);

  // cleanedUserText already in HISTORY

  const turnId = `${Date.now().toString(36)}-${message.id.slice(-4)}`;

  try {
    const reply = await respondAs(
      chosen,
      stageInput,
      {
        silenceBreaker,
        research,
        participants: [...activeParticipants],
        debug: DEBUG_PROMPTS
          ? ({ persona, model, system, input }) => logPrompt(turnId, persona, model, system, input)
          : undefined,
      }
    );

    if (!activeParticipants.includes(chosen)) return;
    pushHistory(`${chosen}: ${reply}`);
    lastSpeaker = chosen;

    await sendViaWebhook(chosen, reply);
  } catch (err) {
    console.error("Router/webhook error:", err);
    await message.react("⚠️").catch(() => {});
  }
});

if (!process.env.DISCORD_BOT_TOKEN) {
  console.error("[boot] DISCORD_BOT_TOKEN missing (check .env + var name).");
  process.exit(1);
}
