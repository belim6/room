# Jev speaker selection + Codex web research

Last updated 2026-09-21. Context for anyone working on this repo.

Two related systems share this file because they ride on the same API call:
**Jev** decides who speaks next; **research** gives that speaker a web lookup
before it answers.

---

## 1. Speaker selection

Four mechanisms, in priority order:

1. **Explicit** — `#persona` in a message, or `/toggle <persona>` to lock. Always wins.
2. **Random** — `pickRandomPersona(lastSpeaker)`, uniform over `activeParticipants`.
3. **Warm-up** — you seed the room; Jev shadows and hands itself over when ready.
4. **Jev** — TypeSafe's "System One" model, via its `Choice` primitive.

Jev only answers *who speaks next* (plus one research question, below). The
persona's actual message is unchanged and still goes through
`modelRouter.respondAs`.

Docs: https://docs.typesafe.ai/introduction

### Files

- `src/jevSpeaker.ts` — API call, sampling, gating, handover thresholds
- `src/research.ts` — Codex CLI subprocess
- `src/jevLog.ts` — per-decision records and the `/jevreport` formatter
- `src/discord.ts` — modes, commands, turn wiring
- `scripts/jevProbe.ts` — offline: one Jev call against a save
- `scripts/researchProbe.ts` — offline: one Codex lookup

No new npm dependency; both use `fetch` / `child_process`. This matters:
`node_modules` here is built for darwin-arm64, so installs are platform-specific.

### The request

`POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer $TYPESAFE_API_KEY`.

One request carries **two questions**, which Jev evaluates independently and in
parallel at near-zero added latency:

- `next_speaker` — a `choice` over the active participants
- `needs_research` — a `noul` (yes/no probability); see §2

**`state` is an object, not a string** — this matters and was a real bug fix.
Named fields the instructions point at with backticks:

```
{ room, participants, transcript, latest_message, last_speaker }
```

`transcript` is the last `JEV_STATE_LINES` (20) entries of `HISTORY` — 20 *turns*,
since each entry is one complete utterance, not 20 visual lines.

**Option descriptions are derived from `PERSONAS` at module load** by extracting
each prompt's "You care about ..." sentence (`priorityOf()`). Editing a persona
prompt automatically changes how Jev sees it. If that sentence is removed from a
prompt, `priorityOf` falls back to the "You are X:" voice line.

**The instructions state intent explicitly**: choose by whose priority is engaged
by `latest_message` (not the general subject), prefer whoever would advance the
exchange, never choose for balance or fairness, never choose `last_speaker`.

This framing is not cosmetic. Measured on saved transcripts, moving from a flat
string + one vague sentence to object state + explicit instructions:

| transcript | before | after |
|---|---|---|
| `topicchange` | 0.16 – 0.34 | **0.61 – 0.63** |
| `antichrist_v2` | 0.85 – 0.92 | **0.93 – 0.94** |

### What happens to the response

Response gives `choice` (argmax), `confidence`, `probabilities` over the active
participants, and the Noul. Then `resolveJevPick`:

- `confidence >= JEV_CONFIDENCE_GATE` → weighted-sample from `probabilities`,
  excluding `lastSpeaker`
- `confidence < JEV_CONFIDENCE_GATE` → **silence-breaker**: the speaker is chosen
  *uniformly at random* (`sampleFrom({})`, probabilities ignored), and
  `respondAs` appends an instruction to introduce a new topic

Note the consequence: on a silence-breaker turn the logged distribution is not
what picked the speaker. `chosen != argmax` is normal and has two causes —
weighted sampling, or argmax being the excluded `lastSpeaker`.

On any API error or timeout: logs and falls back to `pickRandomPersona`. The room
never stalls because of TypeSafe.

### Warm-up and handover

`/select warmup`: you steer with `#name`, random otherwise. Jev still runs every
turn as a **shadow call** — it evaluates and logs, but its pick is unused and it
cannot trigger a silence-breaker. After `JEV_HANDOVER_STREAK` consecutive calls at
or above `JEV_HANDOVER_THRESHOLD`, it announces in channel and switches to `jev`.

Rationale: a cold room gives Jev almost nothing to route on, so early confidence
is low and the silence-breaker fires spuriously. Warm-up removes the cause rather
than patching the symptom.

Costs one Jev call per warm-up turn. `/select warmup` does **not** turn Jev off.

---

## 2. Web research (Codex CLI)

The selected persona can be given a web lookup before it speaks. Results are
injected **silently** — the room sees only the persona's message, with
instructions not to mention searching, sources, or the note.

### Invocation

`src/research.ts` spawns the local Codex CLI per lookup:

```
codex exec --ephemeral --skip-git-repo-check -s read-only \
  -c tools.web_search=true --output-schema <schema> -o <outfile> --color never "<prompt>"
```

- Web search is **off by default** in Codex; `-c tools.web_search=true` enables it
  per-invocation rather than depending on the user's `~/.codex/config.toml`
- `--ephemeral` leaves no session files; `read-only` sandbox so it cannot write
- `--output-schema` forces `{answer, sources[]}`; falls back to raw text if the
  schema is not honoured
- result is read from the `-o` file, not scraped from stdout

Requires `codex` on PATH and authenticated **on the machine running the bot**.
Set `CODEX_BIN` if it lives elsewhere.

### Triggers

- **Explicit**: `?search` anywhere in your message. Stripped before the message
  enters `HISTORY`, so the personas never see the marker.
- **Automatic**: the `needs_research` Noul from the same Jev call, when
  `researchMode === "auto"` and it meets `JEV_RESEARCH_THRESHOLD`.

The response field is `noul` (verified live), not `probability`.

Failures never cost a turn — timeout, missing binary, bad exit and empty output
all log and proceed without research.

---

## Commands

| command | effect |
|---|---|
| `/select random \| jev \| warmup` | speaker selection; **`random` turns Jev off**. Default on boot. |
| `/research auto \| off \| never` | `off` (default) = only `?search`; `never` = no lookups at all |
| `/jevreport` | aggregate routing report; `/jevreport reset` zeroes counters |
| `?search` | in a normal message: force a lookup for that turn |

`/mode` is unrelated — it is persona mode (manual/emergent).
`/participants` controls which personas are eligible; Jev only ever chooses among
`activeParticipants`.

## Tunables

`src/jevSpeaker.ts`, all env-overridable except the first three:

| constant | default | meaning |
|---|---|---|
| `JEV_MODEL` | `jev-latest` | |
| `JEV_STATE_LINES` | 20 | turns of HISTORY sent as state (`MAX_HISTORY` is 40) |
| `JEV_TIMEOUT_MS` | 4000 | then fall back to random |
| `JEV_CONFIDENCE_GATE` | 0.35 | below → silence-breaker (uniform pick + topic change) |
| `JEV_HANDOVER_THRESHOLD` | 0.55 | confidence needed to end warm-up |
| `JEV_HANDOVER_STREAK` | 2 | consecutive confident calls before handover |
| `JEV_RESEARCH_THRESHOLD` | 0.6 | Noul above which `auto` triggers a lookup |

`src/research.ts`: `CODEX_BIN`, `CODEX_MODEL`, `RESEARCH_TIMEOUT_MS` (45000),
`RESEARCH_MAX_CHARS` (1200).

## Logging

Decisions accumulate in memory and are written to `saves/<id>.jev.jsonl` on
`/save <id>` — a sidecar beside `saves/<id>.json`, same basename and sanitising.
`/load <id>` restores it; `/reset` clears it.

Consequences: an unsaved session leaves no log (a crash loses it); saving twice
under one name overwrites; saving with zero Jev turns deletes a stale sidecar.

`/jevreport` shows per persona **turns %** (who actually spoke) and **mean p**
(average probability Jev assigned across all decisions, including losses), plus
mean confidence, mean latency, and how often sampling followed argmax.

Jev never reads this log. It is stateless — it sees only what is in `state`.

## Measured behaviour

- Jev latency 312–1269ms across ~15 calls. One 4s timeout in live use, traced to
  a local connection drop.
- Not deterministic. Same transcript three times: same argmax, confidence
  0.85 / 0.89 / 0.92.
- Distributions are often sharp. At high confidence, weighted sampling picks the
  argmax ~89% of the time, so sampling is close to decorative there. It does real
  work in the 0.4–0.6 range. The `sampling followed argmax` line in `/jevreport`
  measures this.
- Loading a save is seamless: Jev is stateless, `/load` repopulates `HISTORY`,
  and the next turn routes off the restored transcript.

## Known problems

1. **Silence-breaker can cascade.** Observed three consecutive fires
   (0.34 → 0.18 → 0.16): a topic change makes the transcript incoherent, which
   lowers confidence, which triggers another topic change. The §1 instruction fix
   raised those same turns to ~0.62 so it no longer fires there, but nothing
   structurally prevents the loop. A cooldown (no silence-breaker within N turns
   of the last) would.
2. **The gate arguably measures the wrong thing.** Low confidence means a flat
   distribution — "anyone could go here" — not "the topic is exhausted". A
   dedicated Noul on topic exhaustion would be the principled trigger.
3. **4s Jev timeout with no retry** is tight for a sub-second endpoint. A brief
   stall silently substitutes a random pick; the only trace is a console line.
4. **Turn boundaries are ambiguous in `state.transcript`.** A user message can
   contain newlines, so a multi-line turn can look like several turns.
5. **Loading an old save routes it with today's persona definitions**, since
   criteria come from the current `personas.ts`. A confound if comparing routing
   across prompt revisions.
6. **Research latency is unmeasured.** Codex is an agent: seconds to tens of
   seconds, against ~800ms for Jev. `researchProbe.ts` exists to measure it; as of
   this writing nobody has run it against a live Codex.
7. **No pricing data for TypeSafe.** Their docs have no page on pricing, rate
   limits or auth. One call per turn; cost per long session unknown.
8. **Research has never been run end-to-end.** `codex` is not reachable from the
   agent sandbox that wrote it, only from the machine running the bot. Everything
   else here was verified against the live API and saved transcripts.

## Untested assumption

Whether Jev-based selection concentrates turns on fewer personas than random.
Nobody has measured per-persona turn shares across the 84 transcripts in `saves/`
under random selection, which is the baseline any such comparison needs.
