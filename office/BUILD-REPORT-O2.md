# Office O2: build report

**Branch and commit.** Branch `office`. The code is in `1fba0a6`, on top of `03fad98`; this report is committed on top of it.

**Spec and reviews.** I built to `coordination-ref/74-office-o2-spec.md`, including its amendments, and to both critic reviews. That covers the recheck's P2: wrapper tests for stderr, stdin and argument forwarding, and signals.

**What is not done.** The hooks are **not installed** in any settings file. No Codex caller has been **switched to the wrapper**.

## What was built
| Scope item | Where |
|---|---|
| **Live capture: hook.** Claude Code observation hook: reads stdin JSON, writes one sanitized spool line, never prints, always exits 0, and records failures in `errors.count`. | `office/capture/hook.ts` |
| **Live capture: Codex wrapper.** The `office-codex` wrapper around `codex exec --json`. | `office/bin/office-codex` → `office/capture/codex-wrapper.ts` |
| **Live capture: spool records.** Spool records are built through O1's rules. Allowlist checks and withholding run **before** the write; redaction runs at write **and again** at read. | `office/capture/sanitize.ts`, plus `office/collect/withhold.ts` (O1's rules extracted, shared by Expand and the spool) |
| **Live capture: reading the spool.** The spool collector tolerates late, out-of-order and duplicate records. It sorts by timestamp and de-duplicates by record id and by actor/tool call. A tool call already in a transcript is kept once; the transcript copy wins. | `office/collect/spool.ts` |
| **Live capture: tailing and SSE.** Every second the server re-reads the changed append-only sources: spool, `events.jsonl` and driver manifests. It merges by event id, removes events a re-read has superseded, and pushes upserts and removals over `GET /api/live`. When transcripts change, a full collect runs at most every 15 s (`OFFICE_FULL_MS`) as fallback and cross-check. Room's `/api/events` feed is optional (`OFFICE_ROOM_FEED`) and off by default, so nothing touches 4317. Live and replay feed the same event list and the same renderer. | `office/live.ts`, `office/server.ts` |
| **Focus mode.** On by default. It **hides** every actor with no event in the last 10 minutes of the timeline, unless the actor is still open or failed in that window. It shows only the permanent hubs those actors touched. Unticking "focus" restores the full map. | `visibleAt` in `web/model.mjs` |
| **Follow an agent.** Double-click an agent, or use "Follow this agent" in the Inspector. The camera centres and zooms on it, the floor, narration and Inspector narrow to it and its descendants (children it spawns later included), and the Inspector refreshes as events arrive. Escape or ✕ stops following. | `web/office.js`, `descendants` |
| **Narration strip.** Replaces the raw log; a "raw events" toggle brings the log back. Each sentence comes from a fixed template over metadata only, with no model call and no content. Examples: "labeler · Codex · date labeling · T-3911f729 opened the rubric (derived).", "The critic ruled NO-GO on Office O1 (3 findings).", "Coverage gap: …". Click a sentence to open that event. | `narrate` in `web/model.mjs` |
| **Legibility: names.** Agents get names from their spawn context: `kind · family · operation · subject`, e.g. `labeler · Claude · date labeling · T-986dd850`. On the floor the label reads subject first, then kind and family; the Inspector shows the full name. Blind T-ids are **never unmasked**. | `office/collect/legible.ts` |
| **Legibility: operations.** Each operation gets a title, e.g. "Date · labeling · 17 Oct", plus the packet heading where one exists. | `office/collect/legible.ts` |
| **Legibility: edges.** Edges are curved and bundled per pair, with a ×n count, and drawn only while active and only between visible endpoints. | `web/office.js` |
| **Legibility: findings.** A critic's verdict carries a findings count. | `findingsOf` |
| **Acceptance tooling.** A simulator writes a synthetic labeling run through the real capture code into a **throwaway** spool. It refuses the real spool. | `office/capture/simulate.ts` |

## How to run
```bash
cd ~/dev/room-office && npm run office          # http://127.0.0.1:4318 ; live tier on (OFFICE_LIVE=0 turns it off)
```
- Press **● Live** to follow arriving events, untick **focus** to see everything, and double-click an agent to **follow** it.
- Configuration:
  - `OFFICE_SPOOL` sets the spool directory, default `~/dev/room/office-spool/`. It is created on the first write, mode 0700, with files at 0600.
  - `OFFICE_FULL_MS` sets the transcript fallback interval.
  - `OFFICE_ROOM_FEED` takes a URL for Room's ID-only feed. It stays unset until Deniz wants it, because it would read from 4317.
- **Preview without spending.** Point the Office and the simulator at the same temp spool:
  ```bash
  SP=$(mktemp -d); OFFICE_PORT=4319 OFFICE_SPOOL=$SP npm run office &
  node --no-warnings office/capture/simulate.ts $SP 300       # 6 transcripts × (Claude + Codex) labelers, one record per 300 ms
  ```

## Hook settings snippet (ready to paste; not installed)
Add this to `~/dev/room/.claude/settings.local.json`, which is per-machine and not committed. After the Office merges to `main`, change the path to `~/dev/room/office/capture/hook.mjs`. `"async": true` is the critic's P1: tools never wait on the hook.
```json
{
  "hooks": {
    "PreToolUse":       [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node --no-warnings /Users/denizyuksel/dev/room-office/office/capture/hook.mjs", "async": true, "timeout": 10 }] }],
    "PostToolUse":      [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node --no-warnings /Users/denizyuksel/dev/room-office/office/capture/hook.mjs", "async": true, "timeout": 10 }] }],
    "SubagentStart":    [{ "hooks": [{ "type": "command", "command": "node --no-warnings /Users/denizyuksel/dev/room-office/office/capture/hook.mjs", "async": true, "timeout": 10 }] }],
    "SubagentStop":     [{ "hooks": [{ "type": "command", "command": "node --no-warnings /Users/denizyuksel/dev/room-office/office/capture/hook.mjs", "async": true, "timeout": 10 }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node --no-warnings /Users/denizyuksel/dev/room-office/office/capture/hook.mjs", "async": true, "timeout": 10 }] }]
  }
}
```
Before relying on this snippet, check three things:
- **The `async` flag.** It must exist in the installed Claude Code version. If it doesn't, the hook would run synchronously at the latency measured below.
- **Field names.** The hook reads `session_id`, `cwd`, `hook_event_name`, `tool_name`, `tool_input`, `tool_response` and `tool_use_id`. Optionally it also reads `agent_id`, `agent_type`, `agent_transcript_path` and `last_assistant_message`.
- **Sub-agent attribution.** It depends on `agent_id` being present inside sub-agent tool calls. Without it, sub-agent tool calls are attributed to the session. Transcripts stay the fallback and correct this on the next full collect, because the transcript copy wins.

## office-codex: the caller contract
`office-codex [codex exec args…]` behaves like `codex exec [args…]`. `office-codex resume <id> [args…]` behaves like `codex exec resume <id> [args…]`.
- **stdout:** the final agent message only, read from `--output-last-message`. The wrapper uses a temp file, or the caller's own `-o`/`--output-last-message` if one is given. The JSONL event stream goes **only** to the spool.
- **stderr:** Codex's stderr, passed through untouched.
- **exit code:** Codex's own. If Codex dies by a signal, the wrapper re-raises the same signal on itself. If Codex can't be started, the wrapper exits 127.
- **stdin and argv:** argv is forwarded unchanged, in order, so `--output-schema`, `-C`, `-s` and positional prompts all pass through. A duplicate `--json` is dropped. Stdin is forwarded byte for byte; a TTY stdin is inherited rather than piped.
- **signals:** SIGINT, SIGTERM, SIGHUP and SIGQUIT are forwarded to Codex.
- **spool failures** never change stdout, stderr or the exit code.
- **Optional labels** for the Office come from env: `OFFICE_CODEX_ROLE` (`critic` or `labeler`), `OFFICE_CODEX_LABEL` and `OFFICE_OPERATION`.

**Callers to update deliberately (none switched).** These are the Codex callers in this repo's history:
1. `coordination/2026-10-17/date/codexlabel.mjs`. It runs `execFile('codex', ['exec','-C',D,'-s','read-only','-'])` and extracts JSON from stdout+stderr. With the wrapper, stdout is already the final message, so the `ext()` scraping and the `.log` capture change.
2. Inline labeler loops in coordinator Bash. For dinner/ultra labels: `codex exec -C "$PWD" -s read-only - > labels/codex/$k.log 2>…`. For the probe-marta reconcile: `… > reconcile/out/$id.log`. Today their `.log` files hold the mixed transcript. With the wrapper they would hold only the final message, and the exec detail moves to the spool.
3. Critic calls. Before review: `codex exec -C ~/dev/room -s read-only - > …`. Recheck and release: `codex exec resume 01a11601-… - > coordination/critic/critic-*.raw.log`. The `.raw.log` archive would then hold only the verdict. The O1 log parser would see fewer `exec` lines, and the spool would carry them instead.
4. Engineer-branch reviews: `codex exec -C <worktree> -s read-only -`.

## Hook latency (100 synthetic tool calls, this machine)
`node --no-warnings office/capture/bench-hook.ts 100`. The calls mix Read, Bash and Write, before and after the tool runs, into a throwaway spool.

| run | p50 | p95 | max | records spooled | errors |
|---|---|---|---|---|---|
| 1 | 76.1 ms | 281.5 ms | 286.8 ms | 100/100 | 0 |
| 2 | 75.2 ms | 284.6 ms | 370.9 ms | 100/100 | 0 |

**Where the time goes.**
- The hook's own work, sanitizing and appending one record, takes 0.3–2.5 ms.
- The rest is Node starting up (~20 ms) and loading the TypeScript modules through Node's built-in type stripping (~38 ms).
- The p95 tail comes from process scheduling, not from the hook's code.

**Against the original budget.** This is **above the original 50 ms budget**. The amended spec answers that with asynchronous hooks, which don't delay the tool call.

**Hooks off vs on, not measured.** I did not measure the coordinator's tool latency with the hooks off versus on: that needs the hooks installed, and installing them is out of scope here. To do it once they are installed: time 50 trivial Bash calls (`true`) with the hooks block absent, then present. With async hooks the difference should be within noise.

## Tests and checks
Results:
- `npm run test:office` passes 23 of 23: the 14 O1 tests and 9 new ones.
- `npx tsc --noEmit` and `npx tsc -p office` are clean.
- `npm run test:workbench` passes 150 of 150.

New tests in `office/test/office-o2.test.ts`:
- **Hook records.** Covers tool calls, sub-agent start and stop, prompts, pairing each pre-tool record with its post-tool record, Bash file effects (derived), and error outcomes. Records are shuffled and one is duplicated, which must parse identically. A tool call already in a transcript is not doubled.
- **Spool privacy at write.** Planted inputs:
  - off-allowlist file contents in Read results, and unverifiable Bash output (a `$f` loop, and `cd ~/.codex` through the real hook *process*);
  - off-allowlist writes by Write, `echo >>` and Codex `printf >`, plus a multi-line Codex `for … done` loop over off-allowlist files;
  - secrets in prompts, descriptions, outputs, agent messages and Codex errors.

  None of it reaches the spool file, and none of it reaches any API response. Spool files are path-only on `/api/expand/file`.
- **Wrapper contract**, against a stand-in `codex` (`test/bin/fake-codex.mjs`):
  - exit codes 0, 1, 42, and a quota error, with stderr checked exactly;
  - stdout equals the final message, with no JSONL;
  - stderr passes through untouched;
  - stdin is forwarded byte for byte, including unicode, quotes and `$`;
  - argv is forwarded in order, with spaces and `--output-schema`;
  - the caller's own `-o` is honoured, and a duplicate `--json` dropped;
  - `resume` is forwarded.
- **Spool failure.** The spool path is unwritable, and the caller's result is unchanged.
- **Signals.** SIGTERM to the wrapper reaches Codex, and the wrapper dies by Codex's own signal. SIGINT reaches Codex, and the wrapper exits 130. When Codex kills itself with a signal, that signal passes through. A missing binary exits 127.
- **Live vs replay.** A simulated labeling run is appended in six batches, split so that a spawn arrives before its result and a Codex start before its prompt, and the server ticks after each. The SSE upserts and removals, folded by a client, equal the replay `/api/events` list exactly, and `stateAt` is identical at four points in time. Each labeler appears by name, opens its three files and returns its verdict. A planted secret appears neither in SSE nor in the spool.
- **Focus, follow, narration, names.** Focus hides an actor that ended outside the window and keeps unrelated hubs hidden; follow narrows to an agent and its children. The narration sentences are exact and repeatable. Agent names and operation titles are checked.

**Visual check.** I ran a temp server on 4319 with a throwaway spool and the simulator. In Live, labelers appear by name, open their three files on curved bundled edges and end with ✓, and the narration reads them out. Focus hid the older operation actors, and following an agent zoomed onto it with only its own sentences in the narration. That server, the simulator and the temp spool are stopped and removed.

**Port 4318.** A server I did not start, `node --import tsx office/server.ts` (PID 2333, started 10:48 local, cwd `~/dev/room-office`), is listening on 4318. I left it alone.

## Acceptance path (Deniz)
1. Install the hook snippet. Then run the held **date v1 labeling** with its Codex labelers through `office-codex`, setting `OFFICE_CODEX_ROLE=labeler`, `OFFICE_CODEX_LABEL="Codex labeler T-…"` and `OFFICE_OPERATION=2026-10-17/date/labeling`. That needs the caller migrations above, which are deliberate and need sign-off.
2. Open `http://127.0.0.1:4318/#op=2026-10-17%2Fdate%2Flabeling` and press **● Live**, with focus on.
   - Each of the 24 labelers appears by name and opens its three files (labeler instructions, its transcript, rubric).
   - Each returns its verdict, while the narration reads the run out.
   - Everything else is hidden.
3. Afterwards, untick **Live** and replay the same operation: the floor and narration match.
4. To preview this today without spending, use the simulator command above. It covers 6 transcripts × Claude + Codex, i.e. 12 labelers.

## Limits
- **The hook latency is above 50 ms per call.** Reported above; acceptable only because the hooks are async.
- **Codex `--json` event shapes.** The wrapper and collector parse `thread.started`, `item.completed` and `turn.completed`, and the item types `command_execution`, `file_change`, `agent_message`, `reasoning`, `mcp_tool_call`, `web_search`, `todo_list` and `error`. I implemented these from the documented format, **not from a live capture**: no Codex call was made. Unknown event types are kept as type-only records, and lines that aren't JSON go to `errors.count`. The first real run should be checked against `test/bin/fake-codex.mjs`.
- **Live transcripts lag.** Transcripts are tailed by full re-collect, at most every 15 s and about 1.1 s each. Without the hooks, Claude sub-agents appear with up to that lag. Spool, manifest and handoff events appear within about 1 s.
- **The Room live feed is implemented but off.** `OFFICE_ROOM_FEED` would read Room's 4317 feed, which this build was told not to touch. Turns come from driver manifests instead.
- **Agent text is redacted but not allowlist-checked.** This covers prompts, messages, reasoning and final outputs, and applies in the spool too. It is unchanged from O1 and noted in the Expand panel.
- **Not in O2:** the workflow graph (O3; the data model keeps template and run apart), the agent-side narrative, and widening the allowlist.
- **Spool retention.** The spool grows by one file per day per source and has no rotation or retention yet. It is outside `.room-data`, `coordination/` and every agent context, and nothing in any prompt refers to it.

## Review fixes (after the O2 review NO-GO)
These supersede the sections above where they differ. Each fix has a test in `office/test/office-o2.test.ts` named `review N: …`.

1. **HIGH: the Codex working directory is parsed in every form** (`codexCwd` in `capture/sanitize.ts`).
   - Accepted forms: `-C DIR`, `-CDIR`, `--cd DIR` and `--cd=DIR`. Parsing stops at `--`, and the values of flags that take a value are skipped.
   - The cwd counts as undetermined in three cases: two different values, a missing value, or a short-flag cluster hiding a `C` (e.g. `-sC`).
   - When it is undetermined, **every command output of that run is withheld** ("the run's working directory could not be determined"), and the spool records `cwdUnknown` with the reason.
   - Tested on the parser and through the wrapper process. `-C D --cd=/outside`, `--cd /outside` and `-C/outside` leave no planted output in the spool; `-C<allowlisted dir>` shows it.
2. **HIGH: Live catches up.** This is `web/liveclient.mjs`, shared by the page and the test.
   - Every `hello` triggers a refetch of the current operation. A `hello` arrives on the first connect, on the browser's automatic reconnect after a drop, and when Live is switched back on.
   - Deltas that arrive during the refetch are queued and applied after it.
   - Changing operation while Live is on re-subscribes.
   - The test drives a real server through a stand-in EventSource. It checks that events written while Live was off appear when it is switched back on, and that events written during a network drop appear after the automatic reconnect.
   - I also checked this in the browser, on a temp server on 4319 with a throwaway spool. Live on → off, then a simulated run, then Live on: the client went from 0 to 66 run events.
3. **MEDIUM: sub-agent progress triggers the transcript fallback.** The change check now includes size and mtime for every `subagents/**/agent-*.jsonl`, not only the directory. The test appends a tool call to a sub-agent transcript, sees the signature change, and sees the full collect pick the event up.
4. **MEDIUM: PostToolUse output is checked against the PreToolUse cwd.**
   - For Bash, Grep and Glob, the hook finds the call's PreToolUse record in the spool (`findPreCwd`, which reads the tail of today's and yesterday's file). The Pre hook may still be writing, so it retries up to 5 × 100 ms.
   - Output is shown only if it verifies under the Pre cwd.
   - If the two cwds differ, both must be allowlisted directories.
   - With no Pre record, the output is withheld.
   - Tested on the record builder and through two real hook processes, Pre then Post.
5. **LOW: performance.**
   - Spool files are read **only from the last byte offset** (`readSpoolTail`). A partial last line waits for its newline, and a truncated or replaced file (detected by size or inode) is re-read from the start. The test overwrites already-read bytes in place, and only the new tail is parsed.
   - Events for a changed file are rebuilt from cached records. There is no re-read and no re-parse.
   - While the hooks are delivering (a hook record within 2 minutes), the blocking full transcript collect backs off from 15 s to 120 s (`fullMsWithHooks`), because the hooks already cover live activity. Tested.
   - The full collect itself is still synchronous, about 1.1 s. Moving it to a worker is left for O4.
6. **LOW: hook failures and Ctrl-C.**
   - The hook entry point is now `capture/hook.mjs`. It is plain JavaScript using only Node built-ins, and it imports `hook-main.ts` inside a try. A load-time failure (missing file, syntax error, old Node) is counted as `hook-load` in `errors.count`, and the exit status is still 0. Tested by running a copy of `hook.mjs` with no `hook-main.ts` beside it.
   - **The hook snippet above now points at `hook.mjs`.**
   - The wrapper no longer forwards SIGINT or SIGQUIT when it has a terminal, because the terminal already delivers them to Codex, which shares the wrapper's process group. Without a terminal it still forwards them, since a programmatic `kill` reaches only the wrapper.
   - SIGTERM and SIGHUP are always forwarded. Exit and signal passthrough are unchanged. Tested as a unit (`forwardSignal`); the non-terminal forwarding tests still pass.

**Latency after the fixes.** 100 calls, with each Post sharing its Pre's tool-use id as in Claude Code: p50 67.6 / 69.5 ms, p95 269.2 / 271.7 ms, 0 errors. A Bash Post with no Pre record waits up to 500 ms before withholding. That's acceptable because the hooks are async.

## Deniz's decisions (2026-10-18)
**A. Agent text sits behind a third click.**
- Agent-written prose is marked `prose` wherever it is produced:
  - **Codex:** agent and assistant messages, reasoning, error text, and the final message, from both the wrapper spool and O1 log parsing;
  - **Claude sub-agents:** `last_assistant_message`, and the final text in transcripts;
  - **Coordinator transcripts:** assistant text and thinking, plus the agent result inside task notifications and synchronous Agent results.
- **Default views:** `/api/expand/event/:id` replaces prose with a stub titled "unverified agent text: redacted, but not checked against the allowlist". The summary, events and SSE never carried prose and still don't.
- **The third click:** `/api/expand/event/:id/prose` returns only those sections, still redacted. The page shows a **Show unverified agent text** button with that one-line explanation; clicking it fills in the stubs.
- **Test:** planted markers in every prose kind are absent from the summary, the events and every default Expand. All of them are present on the third-click route, with a planted key redacted.

**B. The repo is on the allowlist.**
- **Allowlisted:** `~/dev/room` and its git worktrees, a `room-*` sibling with a `.git` *file*: today `room-stable`, `room-live`, `room-office` and `room-simreason`. `room-backups` is not a worktree, so it stays off.
- **Path-only anywhere inside them:**
  - `.env*` files;
  - `saves/`, `saved/`, `oldsaves/`, `prompt-archive/`, `_dead/`;
  - `node_modules/`, `.git/`, `office-spool/`;
  - `.room-data/`, except the record kinds already allowed; `trash/` stays excluded.
- `.log` files and raw spool files stay path-only. Canonical-path and open-then-verify (TOCTOU) checks are unchanged. `OFFICE_REPOS` overrides the list.
- **Test:** a repo source file is readable, directly and through the server. `.env`, `.env.local`, `saves/`, `saved/`, `oldsaves/`, `prompt-archive/`, `_dead/`, `node_modules/`, `.git/config`, office-spool files and `.room-data/trash` are path-only, and a symlink out of the repo is refused. Shell output inside the repo now verifies; `cat .env`, `cat saves/…` and `cd .git` do not.
- **Withheld commands on real data, before → after**, counting command/tool outputs once per tool call:

| | before (no repo) | after (repo allowlisted) |
|---|---|---|
| outputs shown | 313 | 581 |
| outputs withheld | 2,315 | 2,121 |
| file reads whose content may be shown | 1,091 / 2,127 | 1,881 / 2,128 |

  Most of the remaining withheld outputs come from commands that use `$variables`, heredocs, interpreters (`node -e`, `python3`) or paths outside the repo, like the scratchpad and `~/.codex`. That is fail-closed by design.

**Results:** `npm run test:office` passes 31 of 31, `npx tsc --noEmit` and `npx tsc -p office` are clean, and `npm run test:workbench` passes 150 of 150. My temp servers on 4319 are stopped. PID 2333 on 4318 was left alone.

## Recheck fixes (after the NO-GO on 2a81fa0)
1. **HIGH: case variants could bypass the exclusions, now fixed.**
   - Canonical paths now come from `fs.realpathSync.native`, which returns the on-disk case. This applies to `canonical`, the root paths, and the open-then-verify re-check.
   - Every allowlist, root and exclusion comparison is now also case-insensitive:
     - `under` and the relative-path segments use lowercased paths;
     - `EXCLUDED_SEGMENT`, `ROOM_KINDS`, `.env*`, `.log`, transcript and spool name patterns all use `/i`.
   - **Test `recheck 1`** runs on a case-insensitive temp volume. It skips itself on a case-sensitive one.
     - Path-only, whether read directly, through `/api/expand/file`, or in a shell command: `.ENV`, `.Env`, `.Git/config`, `.GIT/CONFIG`, `OFFICE-SPOOL/…`, `Office-Spool/…`, `.Room-Data/Trash/…`, `.ROOM-DATA/trash/…`, `NODE_MODULES/…`, `Node_Modules/…`, `SAVES/…` and `Saves/…`.
     - An allowed file asked for in another case (`SRC/X.TS`) is still readable.
     - A symlink swapped in between check and open, under a case-variant request, is refused.
   - **Real data:** `.ENV`, `.GIT/config`, `Office-Spool/…`, `.ROOM-DATA/trash`, `Node_Modules` and `Saves` under `~/dev/room` are now path-only. `SRC/workbench/server.ts` is readable.
2. **LOW: prose is now decided on read.** A spool section counts as prose if any of these hold:
   - its item type is `agent_message`, `assistant_message`, `reasoning` or `error`;
   - its record is an `error` or `turn.failed` record, a run's `end` record, or a `SubagentStop` record;
   - its title is a final message or output, a launch result, reasoning or thinking.

   A stored `prose: true` is still honoured; a missing one is not trusted. **Test `recheck 2`:** records written without the flag (agent message, reasoning, final message, `last_assistant_message`) stay out of default Expand, and the third-click route returns them.

**Results:** `npm run test:office` passes 33 of 33, `npx tsc --noEmit` is clean, and `npm run test:workbench` passes 150 of 150.

## Edge labels and friendly file names (Deniz, 2026-10-18)
**Edge labels.**
- Every drawn edge carries a short plain-words summary at its midpoint, e.g. "reads rubric", "writes verdict for T-3911f729", "sends a packet to Critic (Codex)", "rules NO-GO (3 findings)", "dispatches 12 turns".
- The summaries come from `edgeSummary` and `bundleSummary` in `web/model.mjs`: deterministic templates over metadata only (verb, the target's friendly name, the event label, the outcome, the findings count). There is no content, no agent prose and no model call.
- A bundled edge shows its count and its objects, e.g. "reads 3 files: labeler instructions, transcript T-…, rubric", or the latest summary.
- Labels exist only on active edges, as edges always do. They are truncated on the floor; hovering shows the full text, and the tooltip has it too.

**File names.**
- A file target carries a `title`. For an allowlisted `.md` file it is the file's first `# heading`. Files under `restricted/` are never read for a title, and the unmasking key is never used.
- Otherwise the title is the file name in words: dashes to spaces, extension dropped, with blind ids like `T-3911f729` kept intact.
- File chips, edge labels and narration use the title (`fileTitle` in `collect/legible.ts`).

**Tests:**
- `edge labels:` covers ten exact summaries and two bundles, each repeated to check determinism.
- `file names:` covers a heading, the name in words, blind ids kept opaque, and `restricted/` files titled by name only. Planted body content, Codex prose, an unmasked room name and a restricted heading never appear in any edge label, file title or agent name.

**Results:** `npm run test:office` passes 35 of 35, `npx tsc --noEmit` is clean, and `npm run test:workbench` passes 150 of 150. I checked it visually on a temporary 4319 server, now stopped. The 4318 preview server was not touched.

## Critic fixes on fdaa3bb
1. **Agent-written text is out of the labels.**
   - Bash `description` and SendMessage `summary` are no longer copied into `event.label`, whether from transcripts or from the hook spool.
   - `edgeSummary` now only compares `e.label` and never prints it. Command edges read "runs a command", "runs <tool name>" or "runs a workflow"; server dispatches read "dispatches a turn" or "dispatches work"; blocks read "is blocked".
   - In Expand, the Bash description is a prose section, so it appears only behind the third click.
2. **Files under `blind/` or `restricted/` are titled from their opaque name only** (e.g. `T-3911f729`). Their heading is never read.

**Test:** `critic P1s:` plants a revealing heading in a blind file and markers in Bash descriptions and a SendMessage summary, in a transcript and in a hook. None of them appears in any edge label, narration line, event label, file title or agent name, or anywhere in `/api/events` or `/api/summary`. The description appears only on the third-click route.

**Results:** `npm run test:office` passes 36 of 36, `npx tsc --noEmit` is clean, and `npm run test:workbench` passes 150 of 150.
