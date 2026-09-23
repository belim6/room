// src/research.ts
// Web lookup for personas, via the local Codex CLI running headless.
//
// Codex is spawned per research turn as a short-lived subprocess. Web search is
// off by default in Codex, so it is enabled per-invocation with
//   -c tools.web_search=true
// rather than relying on the user's ~/.codex/config.toml.
//
// Requires: `codex` on PATH and authenticated on the machine running the bot.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---- Tunables ----
export const CODEX_BIN = process.env.CODEX_BIN || "codex";
/** Codex is an agent, not an API: seconds, not milliseconds. */
export const RESEARCH_TIMEOUT_MS = Number(process.env.RESEARCH_TIMEOUT_MS ?? 45000);
/** Trimmed before injection so one lookup cannot swamp the persona prompt. */
export const RESEARCH_MAX_CHARS = 1200;
/** Optional model override for research turns only. */
export const CODEX_MODEL = process.env.CODEX_MODEL || "";

export interface ResearchResult {
  answer: string;
  sources: string[];
  latencyMs: number;
  query: string;
}

export class ResearchError extends Error {}

/** Forces a parseable final message instead of free-form agent prose. */
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    answer: {
      type: "string",
      description: "The findings, as compact factual prose. No preamble, no offer to help further.",
    },
    sources: {
      type: "array",
      items: { type: "string" },
      description: "URLs actually consulted.",
    },
  },
  required: ["answer", "sources"],
  additionalProperties: false,
} as const;

let schemaPath: string | null = null;
function ensureSchemaFile(): string {
  if (schemaPath && fs.existsSync(schemaPath)) return schemaPath;
  const p = path.join(os.tmpdir(), "room-research-schema.json");
  fs.writeFileSync(p, JSON.stringify(OUTPUT_SCHEMA), "utf8");
  schemaPath = p;
  return p;
}

function buildPrompt(query: string): string {
  return [
    "Search the web and report what you find. Do not write or modify any files.",
    "Be factual and specific: names, numbers, dates. Note disagreement between sources rather than resolving it yourself.",
    "If the web does not settle the question, say so plainly instead of speculating.",
    "Keep the answer under 150 words.",
    "",
    `Question: ${query}`,
  ].join("\n");
}

/**
 * Run one Codex research turn. Never throws for "found nothing" — that is a
 * successful call with an empty answer. Throws only on a broken invocation.
 */
export function askCodex(query: string): Promise<ResearchResult> {
  const started = Date.now();
  const outFile = path.join(os.tmpdir(), `room-research-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  const args = [
    "exec",
    "--ephemeral",              // no session files on disk
    "--skip-git-repo-check",    // the bot's cwd may not be a repo
    "-s", "read-only",          // Codex must not touch the filesystem
    "-c", "tools.web_search=true",
    "--output-schema", ensureSchemaFile(),
    "-o", outFile,              // final message written here
    "--color", "never",
  ];
  if (CODEX_MODEL) args.push("-m", CODEX_MODEL);
  args.push(buildPrompt(query));

  return new Promise<ResearchResult>((resolve, reject) => {
    const child = spawn(CODEX_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.stdout.on("data", () => { /* progress events; the result comes from outFile */ });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new ResearchError(`codex timed out after ${RESEARCH_TIMEOUT_MS}ms`));
    }, RESEARCH_TIMEOUT_MS);

    child.on("error", (e: any) => {
      clearTimeout(timer);
      reject(
        new ResearchError(
          e?.code === "ENOENT"
            ? `"${CODEX_BIN}" not found on PATH (set CODEX_BIN in .env if it lives elsewhere)`
            : String(e)
        )
      );
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const latencyMs = Date.now() - started;

      let raw = "";
      try {
        raw = fs.readFileSync(outFile, "utf8");
      } catch {
        /* handled below */
      } finally {
        try { fs.unlinkSync(outFile); } catch { /* best effort */ }
      }

      if (!raw.trim()) {
        return reject(
          new ResearchError(`codex exited ${code} with no output. stderr: ${stderr.slice(0, 300)}`)
        );
      }

      let answer = "";
      let sources: string[] = [];
      try {
        const parsed = JSON.parse(raw);
        answer = String(parsed.answer ?? "").trim();
        sources = Array.isArray(parsed.sources) ? parsed.sources.map(String) : [];
      } catch {
        // Schema not honoured; fall back to the raw text rather than losing the turn.
        answer = raw.trim();
      }

      if (answer.length > RESEARCH_MAX_CHARS) {
        answer = answer.slice(0, RESEARCH_MAX_CHARS) + "…";
      }

      resolve({ answer, sources, latencyMs, query });
    });
  });
}

/** System-prompt fragment. Deliberately silent about where the material came from. */
export function researchContext(r: ResearchResult): string {
  if (!r.answer) return "";
  return [
    "Relevant factual material for this turn:",
    r.answer,
    r.sources.length ? `\nSources: ${r.sources.slice(0, 5).join(", ")}` : "",
    "\nUse this where it bears on what you say. It is context you already have, not something you just looked up: do not mention searching, sources, tools, or this note. Do not repeat it wholesale — use only what matters to your point. If it does not settle the question, say so in your own voice.",
  ].filter(Boolean).join("\n");
}
