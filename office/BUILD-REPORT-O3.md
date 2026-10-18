# Office O3: build report

Branch `office`, on top of `2af3e73`. Built to `coordination-ref/76-office-o3-workflow-rooms-archive-spec.md`, including its amendments, and to both critic reviews. That covers the recheck's P2: the unmask record's `operation` must match its folder, lock paths must stay inside that folder, and there are negative tests for both.

## What was built
**1. Workflow graph** (`collect/workflow.ts`, templates in `office/workflows/*.json`, the **Workflow** view)

*Templates.* There are three, written as small data files:
- `experiment-cycle`, for `<day>/<sub>` operations;
- `build-release`, for `office-oN` and other named operations;
- `labeling`, for `…/labeling*` sub-operations.

The most specific template that applies wins. A step is a list of rules over metadata: verb, actor or actor kind, target kind, file pattern, handoff kind, verdict outcome, and position in the round (`after`, `before`, first or later in its loop). A `{phase}` placeholder ties the labeling template to its sub-operation, e.g. `labels-lock-compare` for `labeling-compare`.

*Matching.* Each event gets one of three treatments:
- **direct:** an `events.jsonl` entry names its `step`;
- **heuristic:** exactly one step's rules fit the event in its round's context;
- **unplanned lane:** no step fits a significant event (a handoff, a critic verdict, an error or block, or a packet write), or more than one step fits. Ambiguous events are never assigned arbitrarily.

A step with no event can be **evidenced by its artifact**. Example: a `labels-lock-*.json` written by a script the transcripts can't see. That match is heuristic, names the file, and is placed in the round that was running at the file's mtime.

*Rounds.* A new plan or spec packet after the current round has moved on starts a new round. The date folder has two: plan 68, then v1 (71).

*Loop counts.* These use only direct and unambiguous heuristic matches, and the split is shown, e.g. "critic loop ×3: 0 direct, 3 heuristic", with the verdicts as chips: NO-GO → NO-GO → GO.

*Drawing.*
- The template is an outline; matched steps are solid.
- A step matched only heuristically has a dashed border; a direct match has a solid one.
- Hollow steps say "not yet".
- NO-GO steps are red and GO steps green; the current step pulses.
- Loops are drawn as an arc with their count.
- Clicking a step filters the floor and narration to that step's events, with a ✕ to clear.

*Scope.* An operation's workflow takes in:
- its own subtree;
- coordinator writes and reads in its folder;
- its day-level packets, matched by file name or, new in O3, by first heading ("# Date room, step 0" → `date`);
- the critic sessions that read one of those packets or whose file names the operation (`critic-<day>-<sub>…`).

**2. Rooms and experiment fans** (`collect/rooms.ts`, the **Rooms** view)

*Unmask gate.* Arm names appear only behind a **valid** `restricted/unmask.json`. Valid means all of these hold:
- the record is in the operation's folder, and `operation` equals that folder's id (a sub-operation id is rejected);
- `at` is an ISO date and `by` is present;
- `keySha256` matches `restricted/key.json`;
- every lock path is relative, stays inside the folder, exists and matches its recorded hash, with no `..`, no absolute path and no symlink escape;
- `at` is later than every lock's own `at`.

Anything else is **masked**, including a missing or malformed record. Lock files and the key are read through the same open-then-verify rule as before.

*What masking does.* Trajectory ids `phase·arm·rNN` become `phase·rNN·room A/B`. The order of A and B inside a pair comes from a hash salted with the key's hash, so it can't be mapped back to the arm. The mask applies:
- in manifest event labels and narration;
- in manifest Expand, which then shows only room, turn and speaker, because ids such as `speakerId` can tell the arms apart;
- in driver-state Expand;
- on the file route for `manifest-*.jsonl`, `driver-state.json` and `checkpoints.json`, which become path-only;
- as a final pass over **every API and SSE response**: any trajectory id of a masked operation is replaced wherever it appears, including in a command's output or a quoted packet.

`restricted/` is now path-only everywhere. It is read only internally, for validation.

*Fans.* One lane per room, a tick per turn with the speaker's name, matched pairs side by side, and stopped lanes in red. Clicking a tick opens the turn through the existing Expand tier (the room message from `.room-data`). During replay, ticks after the playhead are dimmed, so turns tick in.

**Today every operation is masked: none has an unmask record yet.** The date v1 compare run shows 6 pairs × 2 rooms × 30 turns, lettered A/B.

**3. Archive** (`/api/archive`, the **Archive** view)
- Every coordination and prompt-knowledge artifact, grouped by operation along a time axis, with its friendly title. A new item (modified in the last 15 minutes, or since the page loaded) glows.
- Each item links to the event that wrote it ("written by …"; "writer not seen" when a script wrote it). It also links to the events that read it ("cited by N", opening the latest one).
- Title search runs as you type.
- Files under `blind/` and `restricted/` are titled by name only.

**4. Agent-side narrative** (`agentStory` in `web/model.mjs`)
- For an agent, a running sentence built from templates over its events: what it read and wrote, the agents it started, its commands and errors, its outcome, and how long it took. For example: "labeler · Codex · date labeling · T-1a2b3c4d: read the labeler instructions, transcript T-1a2b3c4d and the rubric; returned its verdict; finished in 41 s."
- It appears in the agent's Inspector card, and at the top of the narration strip while following that agent.
- It never uses prose or event labels.

**API** (all GET, metadata tier, redacted and arm-masked): `/api/workflow?op=`, `/api/rooms?op=`, `/api/archive?op=&q=`.

## Template step names (for the coordinator's `events.jsonl` `step` field)
| template | applies to | steps, in order | loops (counted steps) |
|---|---|---|---|
| `experiment-cycle` | `<day>/<sub>` | `plan` · `critic` · `fix` · `recheck` · `deniz-go` · `freeze` · `dispatch` · `label` · `lock` · `unmask` · `results` · `critic-results` · `deniz-read` | critic loop = critic, fix, recheck (counts critic + recheck) |
| `build-release` | `office-oN`, other named operations | `spec` · `critic` · `build` · `review` · `fix` · `critic-release` · `deploy` | spec critic loop (critic); review loop = review, fix (counts review) |
| `labeling` | `…/labeling`, `…/labeling-<phase>` | `packet` · `fan-out` · `validate` · `lock` | — |

A `step` value outside the operation's template is ignored and the event falls back to heuristic matching. Pass `operation` alongside `step`, as the new `events.jsonl` lines already do.

## The date v1 cycle on real data (acceptance 1–3)
**Workflow for `2026-10-17/date`:**

| | Round 1 (plan 68) | Round 2 (v1, packet 71) |
|---|---|---|
| plan | plan ✓ | plan ✓ |
| critic loop | **×2** (NO-GO → GO), with fix/amend ✓ | **×3** (NO-GO → NO-GO → GO): critic + recheck ×2 |
| freeze | ✓ (hashes) | ✓ (checkpoints) |
| dispatch | baseline driver ✓ | compare driver ✓ |
| labeling | ✓ (12) | ✓ (the live 10-18 run, 24 labelers) |
| lock | ✓ (`labels-lock-baseline.json`) | ✓, evidenced by `labels-lock-compare.json` |
| results | ✓ (70) | — |
| hollow | Deniz go, unmask, critic-results, Deniz read | fix, Deniz go, unmask, results, critic-results, Deniz read |

Unplanned (5), shown as such:
- the vision write (67);
- the failed-quota critic call, which ended with an error and no verdict;
- an edit to 71 after the compare dispatch.

The sub-operation `…/labeling-compare` shows its own labeling graph: packet ✓, fan-out ✓ (48 events), validate hollow, lock ✓.

**Rooms:** baseline 6 single-room pairs, and compare **6 matched pairs = 12 rooms**, 30 ticks each, all masked ("no unmask record"). No `·v0·` or `·v1·` id appears in `/api/events` while masked. The file route returns `manifest-compare.jsonl` path-only.

**Archive:** the v1 artifacts are listed under "Date · 17 Oct" with their titles and their writer and cited-by links.

## Tests
`npm run test:office` passes 42 of 42: the 36 earlier tests plus 6 new ones in `office/test/office-o3.test.ts`. `npx tsc --noEmit` and `npx tsc -p office` are clean, and `npm run test:workbench` passes 150 of 150.

The new tests:
- **`workflow: the date v1 cycle`.**
  - A fixture of the cycle: two rounds, loops ×2 (NO-GO, GO) and ×3 (NO-GO, NO-GO, GO).
  - Plan 68's amendment is a fix; dispatch and labeling appear in both rounds.
  - The compare lock is evidenced by its artifact; unmask and Deniz's read are hollow; nothing is unplanned.
- **`workflow: direct vs heuristic, the unplanned lane, and loop counts`.**
  - A direct `step` from `events.jsonl` and a heuristic match are reported separately.
  - An event two steps fit goes to the unplanned lane with both candidates, and so does a handoff no step fits.
  - The loop count is 2 (1 direct, 1 heuristic) and excludes the ambiguous verdict.
  - Every shipped template's loop names its own steps.
- **`unmask gate`.**
  - A valid record unmasks.
  - These stay masked: no record, not JSON, an array, another operation, a sub-operation id, a bad `at` or `by`, a key mismatch, a missing lock, a lock hash mismatch, a malformed lock, `..` escape, absolute path, `at` not later than the lock, a response lock pointing to a missing file, a **symlink escape with a matching hash**, and a record placed in the parent folder.
- **`arms are masked before a valid unmask record`.**
  - Fans show `room A/B` with no `traj` field, and speakers survive masking.
  - Across events, rooms, summary, every Expand, and file reads of the manifest, key and unmask record, no `·v0·`/`·v1·` id leaves the server.
  - After a valid record the arm names appear, while `restricted/` stays path-only.
- **`agent narrative`.** Exact and repeated sentences, both finished and in progress, with a planted marker in event labels never appearing.
- **`archive`.** Title search finds a packet by its heading, and restricted files are titled by name only.

**Visual check.** I checked all four views on a temporary server on 4319 against the real records: Workflow (two rounds, loops, hollow steps, unplanned), Rooms (12 masked lanes), and Archive with search. That server is stopped. 4318 and 4317 were not touched, and no hook or settings file was changed.

## Limits
- **The heuristics are tuned to how the coordinator has worked so far.** Packets are named `NN-…plan|proposal|spec|results.md`, critic verdicts are read from the critic sessions' final messages, and drivers have manifests. Steps the transcripts can't see stay hollow unless an artifact shows them, e.g. the round-2 fix and validate. Mis-matches show as dashed (heuristic). Writing `step` into `events.jsonl` makes a match direct.
- **Results packets link to rounds by time.** The baseline results packet (70) sits in round 1. The critic's review of 70 came together with v1, so round 1's "critic on results" is hollow and that review counts as the first critic of round 2.
- **Masking covers trajectory ids.** That means every `phase·arm·rNN` string from a masked operation's manifests, across every API, SSE and Expand response. A packet that discusses "v0 vs v1" in prose still says so, because that is the plan and does not link a room to an arm. Rooms differ by content, as the experiment intends.
- **Room nodes come from driver manifests.** Rooms Deniz opens by hand in Room, outside a driver run, aren't listed. The Room live feed is still off (4317).
- **The workflow graph is computed per request.** It takes about 3–13 ms per operation on the full history (measured). It is not yet incremental with the live tier: reopen the view to refresh it.
