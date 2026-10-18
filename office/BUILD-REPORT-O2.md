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
Add this to `~/dev/room/.claude/settings.local.json`, which is per-machine and not committed. After the Office merges to `main`, change the path to `~/dev/room/office/capture/hook.ts`. `"async": true` is the critic's P1: tools never wait on the hook.
```json
{
  "hooks": {
    "PreToolUse":       [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node --no-warnings /Users/denizyuksel/dev/room-office/office/capture/hook.ts", "async": true, "timeout": 10 }] }],
    "PostToolUse":      [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node --no-warnings /Users/denizyuksel/dev/room-office/office/capture/hook.ts", "async": true, "timeout": 10 }] }],
    "SubagentStart":    [{ "hooks": [{ "type": "command", "command": "node --no-warnings /Users/denizyuksel/dev/room-office/office/capture/hook.ts", "async": true, "timeout": 10 }] }],
    "SubagentStop":     [{ "hooks": [{ "type": "command", "command": "node --no-warnings /Users/denizyuksel/dev/room-office/office/capture/hook.ts", "async": true, "timeout": 10 }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node --no-warnings /Users/denizyuksel/dev/room-office/office/capture/hook.ts", "async": true, "timeout": 10 }] }]
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
