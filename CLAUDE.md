# CLAUDE.md

Guidance for Claude Code working in this repository.

## What Room is

Room is a local, single-user web app for conversations between AI characters and a human, built as a research instrument: every generation is durable, inspectable evidence, and conversations can be branched, retconned, and compared. The user is Deniz.

Read these before non-trivial work:

- **WORKBENCH.md** — what is implemented and how to use it. Keep it current when behavior changes.
- **PRODUCT_SPEC.md** — product direction and the four-release plan. Proposal, not implementation.
- **JEV_SPEC.md** — Jev (TypeSafe's probability model) as a shadow observation instrument for speaker selection.

The repo started from `letta-ai/letta-discord-bot-example`; that history was dropped. The **Discord pipeline is abandoned** — the browser workbench is the only frontend. Don't extend Discord code or propose fixes on that path, even where the specs still mention Discord.

## Commands

```bash
npm run workbench        # serve on http://127.0.0.1:4317 (ROOM_PORT, ROOM_DATA_DIR override)
npm run test:workbench   # node:test suite, mocked providers, temp data dirs
npx tsc --noEmit         # typecheck
```

Node 22, run through `tsx`; no build step and no auto-reload. Server code changes need a restart. `web/` is static and re-read on page reload.

## Worktrees and data

- `~/dev/room` (`main`) is the working copy. `~/dev/room-stable` (`stable`) is a git worktree Deniz uses on 4317 against the real data (`ROOM_DATA_DIR=~/dev/room/.room-data`). Update it with `git -C ~/dev/room-stable merge main` plus a restart, only when asked.
- `.room-data/` holds Deniz's research records. **Never write test turns to it.** To exercise the app, run a second instance on another port with a throwaway `ROOM_DATA_DIR` in the scratchpad, and `ROOM_DEMO=1` to generate without spending. One server process per data directory.
- `saves/`, `saved/`, `oldsaves/`, `prompt-archive/`, `_dead/` are private transcripts and retired code, gitignored. Don't commit them.
- No remote is configured. Commit only when asked; never push without asking.

## Layout

- `src/workbench/` — the app.
  - `store.ts` — JSON-file store: one atomically written file per record, `.room-data/<kind>/<id>.json`.
  - `engine.ts` — branches, immutable state revisions, turns, speaker selection, forks, retcons, trash.
  - `generation.ts` — provider calls (`opengateway`, `together`, and local `demo`, which only generates when `ROOM_DEMO=1`); persists the request before dispatch and the outcome after.
  - `jev.ts` — nonblocking shadow Jev call per turn.
  - `comparisons.ts` — saved side-by-side comparisons of live branches.
  - `server.ts` — Express API, loopback-only.
- `web/` — vanilla JS/CSS frontend (`app.js` holds all UI state).
- Shared with the workbench: `src/personas/personas.ts` (the cast), `src/speakerTurn.ts` (speaker input + wrong-speaker check), `src/replyLimit.ts` (2,000-char cap), `GLOBAL_SYSTEM` from `src/modelRouter.ts`.
- Legacy, not used by the workbench: `src/discord.ts`, `jevLog.ts`, `jevSpeaker.ts`, `research.ts`, `webhooks.ts`, `personaWebhooks.ts`, `participants.ts`, and the Letta leftovers `src/server.ts`, `src/messages.ts`, `setup.sh`. `scripts/jevEval.ts` holds the Jev measurements cited in JEV_SPEC §3.

## Invariants — don't break these

- **Evidence is never overwritten.** Revisions, attempts, outcomes, selections, and Jev records are append-only. Edits create new revisions or branches; they don't mutate old ones.
- **Request before dispatch.** Every provider request is on disk before it is sent; its outcome (raw response, transformations, validation, usage, errors) is a separate record. Rejected and failed attempts survive.
- **Optimistic concurrency.** Mutations take the branch head they expect (`expected`) and reject if it moved. A response that arrives after the branch changed is stored as detached, never appended.
- **Research material never reaches model context.** Observations, Jev output, and edit history stay out of character prompts.
- **Selection provenance.** Every turn records `method` (`forced` | `locked` | `random`; `jev`/`silence-breaker` are reserved for later) plus run info. JEV_SPEC §5 treats this as load-bearing: a pick repeated across a multi-turn run is one decision (`forced` then `locked`), not N.
- **Credentials stay server-side** and are excluded from stored and exported records.
- **No automatic spending.** Branch/edit operations make no provider calls; nothing triggers paid generation, Jev calls, or training without an explicit user action.

## Style

Match the surrounding code: terse, dense TypeScript, few comments, one where the reason isn't obvious. No new dependencies without asking. Add tests to `tests/workbench.test.ts` for behavior changes; use mocked transports, never live keys.
