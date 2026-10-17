# Office O1: build report

Branch `office`, worktree `~/dev/room-office`. Nothing is committed. Spec: `coordination-ref/72-office-spec.md`, including its amendments, the two critic reviews, and the PSRI design rules the coordinator sent mid-build.

## What was built
- **Collector** (`office/collect/`). It reads the saved records once at startup, or again on `GET /api/recollect`, and normalizes them into one event stream in memory. The Office keeps no store on disk, and it never writes to any source.
  - There is one parser per source: `claude.ts` (session and sub-agent transcripts), `codex.ts` (Codex labeler and critic logs), `events.ts` (`events.jsonl`), `manifests.ts` (driver manifests and `driver-state.json`). Coordination and prompt-knowledge files are listed as archive artifacts in `index.ts`. `.room-data` is read only by Expand, in `expand.ts`.
  - `privacy.ts` holds the config, the canonical-path allowlist and the redaction rules. `shell.ts` is a best-effort reader of shell commands, used to work out which files a command read or wrote.
- **Event schema.** Each event follows spec §2: `{id, ts, actor{id,kind,label,parent?}, verb, target?{kind,id,path?}, operation?, cost?, detailRef, source, derived}`. On top of that it carries:
  - `provenance: captured | derived | inferred`;
  - `opInferred`, `tsSource` (`record | mtime | interpolated | linked`), `outcome`, `until`, `label`;
  - `gap{direction}` on cross-check gap events.

  Event IDs are hashes of the source line and the event's role, so they stay stable across re-collects.
- **Server** (`office/server.ts`). It runs Express on `127.0.0.1` only, on port `OFFICE_PORT`, default 4318.
  - It rejects any Host header other than `127.0.0.1` or `localhost`. Every method other than GET and HEAD gets a 405, and every registered route is GET-only.
  - It sends a strict CSP, and every JSON response passes through `redactDeep` as a last line of defence.
  - Routes:
    - `/api/summary`: operations, actors, sources and coverage; metadata only.
    - `/api/events?op=`: event metadata only. The internal `hints` (command and prompt text used for inference) are stripped.
    - `/api/artifacts?op=&group=`
    - `/api/expand/event/:id`: the content tier.
    - `/api/expand/file?path=`: the content tier.
    - `/api/recollect`
- **Views** (`office/web/`, vanilla JS, canvas):
  - **Floor (home).**
    - Permanent nodes sit at fixed positions: Deniz, Coordinator, Critic, Stable server, Providers, and the artifact nodes Archive, Ledger, Vault, Rooms, Code and Elsewhere.
    - Ephemeral agents appear in a bay next to their parent, in spawn order. Files show as chips under their artifact node. Edges are directed and carry moving particles: a read flows artifact→actor, a write actor→artifact, and spawns and messages actor→actor.
    - Line style shows provenance: captured is solid, derived is dashed, inferred is dotted. Red marks a failure or error, and amber a wait or gap.
  - **Replay.**
    - The top bar has an operation picker, which lists sub-operations indented, and a coverage badge for the selected operation.
    - Controls: play/pause (space), speeds of 1×/10×/100×, and "skip idle", which squashes gaps over 30 s down to 3 s.
    - Below the bar is a scrubbable timeline showing event density. Failures are red ticks, gaps are amber ticks, and squashed idle stretches are dashed lines.
    - The footer is a live event log; clicking a line seeks to that event.
  - **Inspector.**
    - Click a node, edge, chip, artifact group or log line to get a summary card. The card shows metadata only: who, what, when, source file and line, cost, outcome and provenance.
    - **Expand** shows the full context:
      - for an agent: its prompt, every file it read with the content it saw, what it wrote, and its final output;
      - for a tool call: the command, its output, and the thinking just before it;
      - for a driver turn: the `.room-data` message;
      - for a gap: the unmatched entry.
  - `web/model.mjs` holds the pure floor model (`layout`, `stateAt`, `timeline`). The page and the tests share it, so replay is a deterministic function of (events, t).
- **Scripts:**
  - `npm run office` serves the app.
  - `npm run test:office` runs the tests.
  - `npx tsc -p office` typechecks `office/`. The root `tsconfig` only covers `src/`, so the Office has its own `office/tsconfig.json`, which extends it.

## How to run
```bash
cd ~/dev/room-office && npm run office     # prints "Office on http://127.0.0.1:4318 (N events, M operations, collected in ~1s)"
open http://127.0.0.1:4318                 # or http://127.0.0.1:4318/#op=2026-10-17%2Fdate%2Flabeling
```
- Source paths default to the real ones and can be overridden: `OFFICE_COORDINATION`, `OFFICE_PROMPT_KNOWLEDGE`, `OFFICE_ROOM_DATA`, `OFFICE_CLAUDE_PROJECT` and `OFFICE_COORDINATOR_SESSION`. By default the largest top-level session is the coordinator.
- Restart the server, or open `/api/recollect`, to pick up records written since it started. O1 does no live tailing.

## Parser coverage, per source (real data, 2026-10-18)
Totals: 8,498 events and 32 operations, collected in about 1.1 s. No source line was left unparsed except where listed below.

| Source | Files / records → events | What it recognizes | What it can't do |
|---|---|---|---|
| Coordinator session transcripts (`<session>.jsonl`, 9 sessions) | 14,641 records → 3,346 events | **Tool calls:**<br>• `Read`/`Write`/`Edit` → read/write (captured).<br>• `Bash` → per-file read/write (derived, parsed from the command), plus a captured `dispatch` to providers for `codex exec`/`codexlabel`, to the server for `:4317`/`driver.mjs`, or to a command otherwise.<br>• `Agent` → `spawn`, linked through `toolUseResult.agentId`.<br>• `SendMessage` → message to the agent; `AskUserQuestion` → message to Deniz; `Workflow` and MCP tools → dispatch.<br>**Results** fill in `outcome` (an error flag or `Exit code N`) and `ms`. Background Bash calls get `until` from their `<task-notification>`; agent notifications become agent→coordinator `message` events.<br>**Text:** Deniz's prompts → message; assistant text → message to Deniz. | Bash file effects are heuristics: pipes into `node -e`, globs and `$(…)` aren't followed. `ToolSearch`/`Skill`/`TaskStop` and similar are muted. Sessions other than the primary one appear as `session:xxxxxxxx` actors, not as the coordinator. |
| Sub-agent transcripts (`<session>/subagents/**/agent-*.jsonl` + `.meta.json`) | 94 files, 5,301 records → 1,284 events | Each file is an ephemeral actor. Its kind comes from the description (labeler, reviewer, engineer or writer) and its parent from `meta.toolUseId` → the spawning `Agent` call. The parser records the actor's own tool calls; its `end` event carries the last text, calls and tokens (input + cache creation + output, per message id). Workflow agents with no Agent call get an **inferred** spawn at their first record. Nested agents link to their parent agent. | The time a workflow agent was linked is inferred. The agent kind is a keyword guess. |
| Codex labeler logs (`**/labels/codex/*.log`) and critic logs (`critic/*.log`) | 92 files → 671 events, all **derived** | Splits the log into sessions on the `OpenAI Codex v` header, then reads the header fields, the `user` prompt, `exec` sections (inner command and cwd, giving per-file reads and writes), `ERROR:` lines, the final `codex` message, and `tokens used` (`3.469` → 3,469).<br>**Outcomes:** labelers get `verdict`, `extraction-failed`, `extraction-failed-repaired` or `no-output`; critics get `no-go`, `conditional-go`, `go`, `done` or `error`.<br>The stdout preamble before the header is counted and reported as a source note, not parsed. | **The logs carry no timestamps.** The end time is the file mtime. The start is the coordinator's launching Bash call, when one names the log or runs codex in that folder (`tsSource: linked`); otherwise it is mtime − 60 s and inferred. Steps inside a session are spread evenly between start and end (`tsSource: interpolated`). The Office never shows Codex activity that the log doesn't contain. |
| `coordination/events.jsonl` | 16 → 16 events, captured | `kind` maps to a verb (packet/review/result → message, build/dispatch → dispatch, blocked → block, …). Names map to actors: claude → coordinator, stable → server; unknown roles become `role:<name>`. An explicit `operation` is honoured. A `review` note with GO or NO-GO becomes an outcome. | The `note` is content, so it appears only on Expand. |
| Driver manifests (`**/manifest-*.jsonl`) | 7 files, 2,980 records → 2,994 events | One driver actor per manifest.<br>• branch → write to Rooms; phase-start and sweep → rule.<br>• intent → dispatch to the server, with the picked speaker.<br>• done → server `turn` targeting the turn id; Expand reads the `.room-data` revision and shows the actual message.<br>• phase-end with stops or failures → block.<br>• Unknown kinds are counted as `unparsed`, never guessed. | Starting and ending a driver is inferred from the first and last line. |
| `driver-state.json` | 4 files | An explicit `stopped` becomes a `block` event. Otherwise nothing is emitted, because the manifest already holds each turn. | — |
| `.room-data` | read on Expand only | `revisions/<id>.json` → the message by `messageId`. Readable kinds: `revisions`, `turns`, `attempts`, `outcomes`, `branches`, `vault-*`, `experiment*`. | — |
| Coordination and prompt-knowledge files | listed as artifacts | Path, size, mtime, group and inferred operation. Contents only on Expand. | — |
| Derived failure events | — | **Missing labels.** If a `blind/T-*.md` has no `labels/<family>/T-*.json`, that becomes an `error` event, inferred. There are none in today's data. | — |

**Operations.**
- **Explicit.** An `operation` on `events.jsonl` is used as-is. It also pins the spawn or dispatch near it that names the same ref, along with that actor's events. Example: `office-o1` → this build.
- **Inferred** (`opInferred`), from paths in the event's target or hints:
  - `coordination/<date>/<sub>/…` → `<date>/<sub>`;
  - `labels/`, `blind/`, `codexlabel` or label freeze/lock files → `<date>/<sub>/labeling`;
  - `manifest-<phase>` → `<date>/<sub>/run-<phase>`;
  - top-level packets and `critic-<date>-<slug>` files are matched to a subfolder named in their filename.
- An ephemeral actor takes the deepest operation among its events. A coordinator event with no path inherits the operation of the previous coordinator event, if that was within 2 minutes.
- The picker includes all children when a parent is selected.

**Cross-check (Q3).**
- Each coordinator entry in `events.jsonl` is matched to a coordinator tool call within ±30 min whose input names the ref's basename. Tool calls that write `events.jsonl` itself are excluded.
- From the first `events.jsonl` entry onward, each handoff-class tool call is matched to a log entry within ±30 min that names the same ref or shares its operation. Handoff-class calls are: Agent spawns, codex or driver dispatches, and messages to agents.
- An unmatched item on either side becomes a `deviation` event with a `gap` field, `provenance: inferred`. Neither side is presumed complete.
- Real data has 81 gaps. Most are handoffs before logging discipline existed; `events.jsonl` has only 16 lines.

## The PSRI design rules
1. **Template vs actual run.**
   - O1 has no workflow view yet. Instead, each operation carries `workflow.template` (the spec §3 steps, `source: "template"`) and `workflow.run` (steps observed in events, `source: "events"`), so O3 can draw the template faint and the run solid.
   - The run-path step detection is coarse: one step per change, which gives interleaved dispatch/label steps during parallel labeling.
2. **Every state comes from an event.**
   - Actor states come from `stateAt`:
     - `active`: pulses only for a short window after one of the actor's own events;
     - `open`: spawned and not ended; a steady outline, no pulse;
     - `ended` with an outcome mark;
     - `waiting` and `blocked`: only from explicit wait or block events;
     - `idle`: permanent nodes with no recent event;
     - `unknown`: an actor with no lifecycle events, drawn as a dashed circle with "?".
   - Nothing says "thinking" or "working".
3. **Failures carry the same visual weight as activity.**
   - Ended agents that fail keep a full-opacity red ring and ✕; successful ones fade to a ✓ ghost. Failed outcomes are error, no-go, extraction-failed, missing, no-output and stopped.
   - Failures and gaps show as red and amber ticks on the timeline, red lines in the log, and counts beside the actor (`✕n gapN`). The coverage badge shows gaps in red.
   - Critic NO-GOs are outcomes (12 in the real data). The coordinator's failed Codex extraction on 10-17 is visible as a red dispatch with `Exit code 1`.

## Test results
`npm run test:office` passes 8 of 8. `npx tsc --noEmit` (root) and `npx tsc -p office` are clean. `npm run test:workbench` passes 150 of 150, so Room is unaffected.

The fixtures in `office/test/fixtures/` are trimmed real records with paths remapped to `__ROOT__`: the coordinator lines for one Codex dispatch and one labeler spawn, the T-3911f729 labeler sub-agent, a Codex labeler log, a critic log, a manifest and a revision. A few hand-built lines are added in the same format. Secrets are planted at test time, so no secret-shaped string is committed.

| Gate | Test |
|---|---|
| Parsers per source | `parsers: …`: session, sub-agent (3 reads + 1 off-allowlist read, verdict write, end with tokens), Codex labeler (spawn linked to 17:41:50.166Z, exactly 3 derived reads, `verdict`, 3,469 tokens, end at mtime), critic `no-go`, handoffs, manifest turn plus one `unparsed` unknown kind, driver-state, two missing-label failures. Plus `shell facts`. |
| **Privacy** (release gate) | `planted secrets of every pattern never appear in any API response`: crawls every route, every event expand and every file expand. Patterns: sk-ant, sk-proj, ghp_, Bearer, Basic auth, `*_API_KEY=`, `.env` lines, hex and base64 next to secret/token/password, foreign email, AWS key. `osmanabuziddin@gmail.com` is kept.<br>`summary tier is metadata only`<br>`off-allowlist, traversal and symlink escapes return the path only`: a symlinked file, a symlinked directory, `..`, a forbidden `.room-data` kind, Claude `memory/`, `/etc/hosts`, `~/.ssh`. |
| **Read-only** (release gate) | `source trees unchanged…`: lstat mtimes of every file and directory are compared before and after a full crawl, a recollect and a 200-step replay. POST, PUT, PATCH and DELETE all return 405, and every Express route is GET-only. |
| **Replay** (release gate, automatable part) | `replay determinism`: two collects give identical events and operations, and the same `t` gives the same state and layout. At 17:43 both labelers are `ended` with `verdict`; mid-labeling the Claude labeler is open or active; nothing shows before the first event. The compressed clock is invertible. |
| **Coverage** (release gate) | `coverage gate`: the fixture has one logged packet that was never sent and one unlogged Agent spawn. Expected and observed: gaps 2 / 1 / 0 for `2026-10-17`, `…/date` and `…/date/labeling`. Provenance counts and gaps sum to the event count, and template and run stay distinct. |

I also ran an ad-hoc check against the **real** records: all 8,492 event expands returned 200. No `sk-…`, `ghp_…`, Bearer or AWS shape appeared, and no foreign email; the only hits were false positives (an escaped newline before `deniz@`, and "task-full-read").

## Acceptance demo (Deniz)
1. Run `npm run office` in `~/dev/room-office` and open `http://127.0.0.1:4318/#op=2026-10-17%2Fdate%2Flabeling`. The page opens on this operation by default.
2. The top bar reads `2026-10-17 · date · labeling`, with the badge **45 captured · 49 derived · 1 inferred · 7 gaps · operation inferred**.
   - The 7 gaps are honest. The six Claude labeler spawns and the Codex dispatch have no `events.jsonl` entry, because logging discipline starts in O2.
3. Drag the scrubber to the start, choose **10×** and press **▶** (or space).
   - 17:41:50: the coordinator dispatches the Codex run. Six `codex labeler T-…` nodes spawn in its bay, on dashed edges because they are derived.
   - 17:41:52–17:42:02: six `Label T-…` Claude labelers spawn on solid edges.
   - Each labeler opens its three files: `labeler-prompt.md`, `blind/T-….md` and `rubric-v1.md`. Each read is a particle flowing from the file chip under **Archive** to the labeler.
   - Claude labelers write `labels/claude/T-….json`, a green particle back to Archive, and end with ✓. Codex labelers end with outcome `verdict`.
   - At 17:43:33 the critic session (`critic-2026-10-17-date-baseline.failed-quota`) reads the packet, then ends **red** on its quota `ERROR`.
4. Click any labeler. The card shows its provenance mix and cost. **Expand: prompt, files read, output** shows the prompt, the three files as the agent saw them, the JSON it wrote or returned, and the source file and line.
5. Click a log line or an edge to see that single event, with its provenance badge, `time from` (record, linked, interpolated or mtime) and its source line.

## Known limitations
- **No live tailing; this is O2.** The collector runs at startup and on `/api/recollect`, and a full collect takes about 1 s.
- **Codex timing is reconstructed**, from file mtime, linked launch calls and even interpolation, and it is labelled as such. All Codex activity is `derived`.
- **Inferring operations is heuristic.** Coordinator chatter between operations goes unassigned or rides on the previous operation for up to 2 minutes. A critic session that read the lock file is placed in `…/labeling`.
- **Workflow view, rooms view, archive view, ticker, waits and cost meter are O2/O3.** O1 has only the data model for template vs run.
- **Bash output is withheld when the command reads an off-allowlist path.** Output of other commands is shown redacted. Repo source files (`~/dev/room/src`, `web`) aren't on the allowlist, so they show as path only. That is strict by design, and the allowlist can be widened if Deniz wants.
- **Redaction is pattern-based.** A secret that matches none of the patterns, such as a bare random token not next to a key/token/secret/password word, would pass. The `KEY=value` rule over-redacts harmless env lines on purpose.
- **Layout is fixed and simple.** On "all operations" (about 8.5k events) the bays get crowded; there are 20 visible chips per artifact node, plus a "+N files" count. Layout polish is O4.
- **Sessions other than the primary one are not treated as the coordinator.** Their tool calls do take part in the cross-check.

## Review fixes (after the NO-GO on privacy)
The review returned NO-GO on privacy. Every finding is fixed, and where this section disagrees with the sections above, this section wins.

### HIGH
1. **Raw sources are no longer served whole.** `/api/expand/file` now returns only the path, plus a note, for:
   - session transcripts and sub-agent transcripts;
   - any `.log` file under coordination (Codex labeler, critic and driver logs).

   Their content is reachable only through per-event Expand, which applies the rules in fix 2. The rules are split into three separate checks (`privacy.ts`):
   - `allows()` decides what content can be shown.
   - `allowsSource()` decides which files the collector and the per-event Expand may read.
   - `isTranscript()` accepts only `<uuid>.jsonl` files and `subagents/**/agent-*.jsonl` files.

   Workflow `journal.jsonl` files, `memory/` and `tool-results/` are rejected.
2. **Shell output now fails closed.** The check is `verifyCommand` in `shell.ts`. A Bash command's output, or a Codex `exec` output, is shown only when all of the following hold:
   - the command contains no `$`, backticks, heredoc, process substitution, subshell or env assignment;
   - every program in it is on a short list of read-only tools; interpreters, `awk`, `find`, `xargs`, `curl` and `git` are all unverifiable;
   - any `sed` script is a plain print;
   - it uses no globs and no flag names a path;
   - its working directory, and every `cd` target, is inside coordination or prompt-knowledge;
   - every argument resolves to an allowlisted path.

   Otherwise the page shows the command and **"output withheld (unverifiable): reason"**.
   - Codex `exec` sections are now parsed as **multi-line** commands (`execOf`), up to their status line.
   - `Grep` and `Glob` follow the same rule (search root must be allowlisted; the pattern can't leave it).
   - Results from tools without a specific rule are withheld.
   - Real data: 610 outputs shown and 2,900 withheld. The reported leaks are now withheld: the critic-dispatch `cat …/.room-data/trash/…; node - <<JS` sections, and the `$f`, `cd ~/.codex`, `node -e` and off-allowlist-cwd forms.
3. **TOCTOU.** `openVerified` opens with `O_NOFOLLOW`, then requires three things: `realpath(c) === c`, the path still passes the allowlist, and `fstat(fd)` dev/ino equals `stat(realpath)`. Any mismatch is refused. File reads, transcript line reads (`lineAt`) and Codex log reads all go through it.

### MEDIUM
4. **Redaction covers the reported forms:**
   - JSON-quoted and escaped keys, e.g. `"TOGETHER_API_KEY": "…"` and `\"Authorization\": \"Basic …\"`;
   - `*_PASS` and `*_KEY` names;
   - `.env` lines that follow a literal `\n` inside JSON strings;
   - the `tgp_v1_…` prefix.
5. **No more false gaps.** The cross-check no longer drops calls that mention `events.jsonl`. It strips the appended JSON line and any shell segment that writes to `events.jsonl`, then matches on the rest. The 10-09 15:30 and 15:40 entries now match. One gap remains on the real data among logged entries: the 10-09 12:02:58 `blocked` entry. Its ref (`critic-2026-10-09-simreason-release.failed-quota`) isn't named by any coordinator call within ±30 minutes.
6. **Malformed timestamps no longer crash `collect()`.** In `events.jsonl`, manifests, `driver-state.stopped.at` and transcript records, an invalid timestamp is counted as `unparsed`.

### LOW
7. **Codex labeler output appears once.** Its file cards no longer repeat the concatenated `cat` output. The command and its output show once, and each read card says the content is in that output. Splitting the output by file was not reliable, so I didn't do it.
8. **Path fields are no longer mangled.** `redactDeep` applies only the key-prefix rules (sk-, sk-ant-, tgp_v1_, gh*_, AKIA, JWT) to `path`, `id`, `source`, `file`, `ref`, `agentFile`, `launch`, `of` and `parent`. Content fields get the full rule set.
9. **Transcripts have their own node.** Files under the Claude project directory now group under a new permanent **Transcripts** node, shown as a count only, not as chips.

### Tests added
`npm run test:office` now passes 13 of 13 (up from 8). Changes to existing tests:
- The parser test now asserts two unparsed manifest lines (the unknown kind plus a malformed timestamp), plus an unparsed handoff line and an unparsed transcript record.
- The off-allowlist test plants unverifiable commands and asserts none of their markers appears in any response. They cover: `$f` loops, `cd ~/.codex && …`, `node -e readFileSync`, an off-allowlist cwd, and a multi-line `for … done` exec in a critic log. A verifiable `cat … | head` must still show its output.
- The secrets list adds JSON-quoted, escaped, `\n`-env and `tgp_v1_` forms.

New tests:
- **raw sources:** `expand/file` is requested for every file under the project directory and coordination; transcripts and `.log` files are path-only, and the journal is rejected.
- **escaped and JSON-quoted secrets:** paths get only the key-prefix rules.
- **self-logging call:** a fixture where the dispatch and its `events.jsonl` line share one Bash call; no gap appears on either side.
- **symlink swap between check and open:** simulated with the `beforeOpen` seam. A file swapped for a symlink, and a parent directory swapped for a symlink, are both refused, directly and through the server's file route.
- **Codex output once:** the labeler's output appears once, and the multi-line critic exec is withheld with its reason.

`npx tsc --noEmit` and `npx tsc -p office` are clean, and `npm run test:workbench` passes 150 of 150. No server is left running on 4318.

### Remaining limits
- Assistant `text` and `thinking`, and agents' final outputs, are shown redacted but are not checked against the allowlist. An agent that quoted an off-allowlist file in its own words would show that quote.
- A command that names the repo root (`~/dev/room`) or a worktree is withheld (869 cases in real data). That is the intended fail-closed cost, and widening the allowlist is Deniz's call.
