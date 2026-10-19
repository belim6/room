# Office O4: build report

Branch `office`, on top of `9fe7252` (O3). Built to `coordination-ref/office-o4-spec.md` and its amendments (critic `critic-2026-10-19-office-o4-precommit.md`: GO with corrections). **Not released**: O3 and O4 ship together after the Claude reviewer rerun and the critic's combined release review. `office-stable` and the launchd Office on 4318 were not touched.

## A. O3 release item: Codex privacy P1 (room feed and operation metadata)
**Verdict: one real hole, now closed, plus one O4 gap closed before it opened.**
- **Hole.** `Live.notice()` accepted any `id` matching `[\w-]{1,128}`. A notice whose `id` was text (e.g. `TURN-TEXT-the-cat-sat-on-the-mat`) went into `target.id` on `/api/events` and `/api/live`, so turn text could reach the metadata tier. Trajectory ids (`·v0·`) could not pass the regex, but `[\w-]` is not an id check.
- **Fix** (`live.ts`): only Room's own record ids pass, i.e. UUIDs (`randomUUID` in `src/workbench/store.ts`). The branch must be a UUID too, or it is ignored. Every other notice field is dropped, the label stays fixed (`turn (live)`), and an invalid `at` falls back to the time the notice arrived.
- **Operation metadata** (titles, packet headings, coverage, workflow) already went through `maskDeep` on every route. The test confirms that a packet heading naming trajectories comes out as `room A/B`.
- **O4 gap.** Masking only scanned `coordination/<day>/<sub>`. It now also covers `work/<thing>` (see C3).
- **Test** `privacy P1: …` drives the real HTTP server and a live SSE stream. It sends text-as-id, trajectory-as-id, a path, a 40-char non-UUID, a text-bearing non-turn notice, a valid notice carrying extra `text`/`traj`/`label` fields, and a bad branch. Checks:
  - no turn text and no `·v[01]·` in `/api/summary`, `/api/events` (all, and per operation) or `/api/live`;
  - only the two UUID notices became events;
  - the operation is taken only from a known branch;
  - Expand of the feed events carries no text.

## B. Session identity: what I found (before choosing a mechanism)
Evidence: the hook spool (`office-spool/hooks-2026-10-1{8,9}.jsonl`, 776 records, 7 sessions), the 14 transcripts in `~/.claude/projects/-Users-denizyuksel-dev-room/`, and the environment of a Claude Desktop Bash tool.

| Where | Field | What it is |
|---|---|---|
| hook payload → spool | `session_id` (spool `session`), `cwd`, `agent_id` | The session UUID. It equals the transcript file name. Our hook drops `transcript_path`, which is the same thing. Nothing in the payload names the Desktop session. |
| transcript, every record | `sessionId`, `entrypoint: "claude-desktop"`, `version`, `cwd`, `gitBranch` | All 14 transcripts are Desktop sessions. |
| transcript | `{"type":"custom-title","customTitle":…}` and `{"type":"agent-name",…}` records | **The Claude Desktop session title, the name Deniz sees in the sidebar.** These records carry no timestamp and are re-emitted often (419 times in `83d97c5f`), so the change points are what matter. Deniz has renamed sessions to role names: `partner`, `operator`, `secretary`, `housekeeper`, `critic`, `experimenter1/2`. Other titles are auto-generated ("Coordination folder overview", "Room build"). |
| Bash tool env | `CLAUDE_CODE_SESSION_ID` | The session UUID, available to any command a session runs. |
| Bash tool env | `CLAUDE_CODE_MESSAGING_SOCKET` (`/tmp/cc-socks/<pid>.sock`), `CLAUDE_PID` | The address other sessions use to reach this one. It changes when the process restarts. |
| Bash tool env | `CLAUDE_CODE_HOST_SESSION_ID` (`local_6925112a…`) | The Desktop host. It is shared by partner, operator and brainstorm, so it does **not** identify a session. Peer messages carry it as `fromSession`. |
| inter-session send (sender transcript) | `SendMessage {to, recipient_kind: name\|session}`; the result's `toolUseResult.msg_id` | `to` is a Desktop title (e.g. `operator`, `Acting Critic Bootstrap`) or a socket (`uds:/tmp/cc-socks/75537.sock`). A failed send has `success:false` (a stale socket after a restart). |
| inter-session delivery (receiver transcript) | user record, `isMeta`, `origin {kind:"peer", from:<socket>, name:<sender's title>, msg_id, body}` | The same `msg_id` as the send, so a send and its delivery link exactly. |
| forks / resumes | new `sessionId`; the copied records keep their `uuid` | `8ce255fe` and `9351fe45` are forks of `83d97c5f`. They repeat about 3,000 of its records with the same uuids. **O1–O3 counted those twice**, which is now fixed (see C1). |
| Codex | `thread_id` in `--json`; the resume id in args | The critic's session. A rotation is a new thread: `01a15421…` → `01a154a3…` on 10-19. |

**Timeline on 10-19 (from titles and deliveries):**
- `83d97c5f` (the old coordinator, "brainstorm") is renamed **operator** at 12:06 and **partner** at 14:49.
- It is forked into `8ce255fe` (partner, 15:17), then into `9351fe45` (partner, 16:41).
- `6d476469` becomes the new **operator** at 15:14, `6d4c6f06` the **housekeeper** at 15:04, and `f23b74aa` the **secretary** at 12:08.

## C. What was built

### 1. Sessions by role (`collect/roles.ts`)
**Registration mechanism: self-registration command, with the Desktop title as fallback.** Why:
- The session id is exactly what the hooks and transcripts key on, and `CLAUDE_CODE_SESSION_ID` gives a session its own id with no guessing.
- The socket is recorded at the same time, which resolves messages sent to it.
- Desktop titles already name roles. They are good evidence but can be wrong (a title is free text, and auto titles exist), so they count as derived.

**How a session registers.** As its first step it runs one line, which belongs in each role file's startup step (I did not edit `roles/`):
```
~/dev/office-stable/office/bin/register-session <role>     # partner|coordinator|prompter|experimenter|engineer|operator|housekeeper|secretary|critic
```
- It appends `{session, role, since, socket, note?, by}` to `~/dev/room/roles/sessions.json` (`OFFICE_SESSIONS` overrides), creating the file on first use.
- The write is atomic (temp file + rename) under a lock directory.
- It is idempotent: the same role and socket print "already registered".
- A new role is a new entry with its own `since`.
- It refuses, and writes nothing, in these cases: an unknown role, no `CLAUDE_CODE_SESSION_ID`, invalid JSON, or a file not in its own format (so a hand-kept file is never rewritten).
- **It is the only writer.** The Office only reads.

**Resolution, per record** (registry > title > primary > none):
1. **registry:** the latest entry with `since` ≤ t. The first entry also covers the moments before it.
2. **Desktop title** in effect at that point of the transcript, when it is a role name. `experimenter1` counts; `experiment2` does not. A title set within the first 15 minutes covers the session from its start.
3. **The pre-O4 primary** (largest transcript) is the coordinator.
4. Otherwise **`session ‹id8› (unregistered)`**, drawn dashed with "unregistered" under it. Its Inspector says how to register it.

The registry may also be a hand-kept map (`{sessions:{id:{role,since}}}`) as the coordinator's fallback. Malformed entries are skipped and counted.

**One node per role.** Forks, resumes and rotations are listed as sessions of that node. The Inspector lists each session with its id, time span and how it was identified, and marks every later one as the previous one's successor. Role nodes are permanent, with fixed floor positions (`web/model.mjs PERM`), and have their own kind and colour. The critic is one of them (C4).

**Forks count once.** Sessions are read in the order they began. A record uuid already seen belongs to the session that wrote it first. The fork's own tail is attributed normally. On real data: 3,016 and 3,094 repeated records, each noted on its source.

Peer deliveries were being read as **Deniz writing** to the receiver. Fixed.

### 2. Messages between sessions (`claude.ts`, `index.ts linkPeers`)
- **Send ↔ delivery by `msg_id`:** captured on both ends, outcome `delivered`. The receiving role is the receiver's role at delivery time.
- **A send with no delivery found:** resolved by socket or by name, provenance **derived**.
  - Socket: learned from linked pairs, or from the registry.
  - Name: a title exactly one session carried, or a role name.
  - If neither resolves it, the target is "another session (not found)".
  - A failed send is a red edge "(not delivered)".
- **A delivery with no send** (the sender's transcript is elsewhere): becomes the event, **derived**. The sender comes from its socket or name.
- **Replies:** a message back to a session that wrote to this one within 24 h is labelled a reply.
- **The hook spool's live SendMessage** resolves by socket or name until the next full collect links it.
- **Edge labels:** "asks Operator: File reorganisation: from the old layout to ROOM.md's hierarchy", "replies to Partner: …", "(not delivered)". Narration: "Partner asked Operator."
  - **Deviation from the spec's example ("…: file reorganisation brief"), for the critic.** The topic is the *operation's* title (README heading), not the agent's `SendMessage` summary. O2's critic fix keeps agent-written text out of labels, and that rule is binding.
  - The message body is shown in Expand, as the coordinator's `SendMessage` to sub-agents already is.

### 3. The new structure as roots (`privacy.ts`, `index.ts`, `rooms.ts`, `legible.ts`)
- **`work/<thing>/` is an operation `work/<thing>`.**
  - It is inferred from any path naming it.
  - Its label is the README's first heading.
  - Its README `**Status…**` line is shown with the operation in the Archive (`/api/archive` → `status`).
  - Files group under a new **Work** artifact node.
- **`research/<topic>/` is an operation**, and **PSRI** is a permanent node.
  - A session writing a `commission|brief|request|question` file there → an edge to PSRI: "commissions research on <title>".
  - A `synthesis|report|findings|answer|result` file there → an edge from PSRI to whoever commissioned in that folder: "delivers research: <title>". It is timed by file mtime and inferred.
  - PSRI's own work stays invisible.
- **Configurable roots:** `OFFICE_WORK`, `OFFICE_RESEARCH`, `OFFICE_SESSIONS`, `OFFICE_EXTRA` (default `critic/:briefing/`), plus the top-level `events.jsonl`.
- **`coordination/`:** `OFFICE_COORDINATION`, or, when unset, whichever of `coordination/` and `archive/coordination/` exists. **Phase 2 needs no env change.** Old paths still infer operations, because the matcher keys on `coordination/<date>/…` anywhere in a path.
- **Restricted folders and unmasking.**
  - `work/**/restricted/` is path-only, as before.
  - The unmask rule applies per operation folder (`opFolderOf`): `coordination/<day>/<sub>`, or `work/<thing>` with manifests up to three levels down.
  - The record must name `work/<thing>`.
  - Manifest, driver-state and checkpoints files under `work/` are path-only while masked.
  - The `/api/rooms` operation id is validated, which also closes `…/..`.
- `findings/` stays `OFFICE_PROMPT_KNOWLEDGE`, unchanged.

### 4. The critic as one node (`spool.ts`, `codex-wrapper.ts`)
- **One node.** `office-codex` runs with `OFFICE_CODEX_ROLE=critic` attach to the permanent **Critic** node; there is no per-run node any more.
- **Sessions and successors.** Each Codex thread is listed as a session, and a new thread is the successor.
- **Edges.** Each run is "caller → critic: asks for a review" and "critic → caller: rules GO/NO-GO".
  - `office-codex` now records the caller's `CLAUDE_CODE_SESSION_ID`.
  - Runs from before that are linked to the session whose Bash call launched them, at most 3 minutes earlier (derived). Otherwise they fall back to the coordinator (inferred).
- **Every ruling stays.** The `end` dedupe key includes the run id, so separate rulings are no longer collapsed.

### 5. Role-to-role loops (`workflow.ts roleLoops`, Workflow view)
- **What counts.** Hand-offs between role nodes are session messages, `events.jsonl` hand-offs, critic requests and rulings, and research commissions and deliveries.
- **When a loop closes.** A loop closes when work returns to the role that started a chain: A → B → A, or A → B → C → A, up to four roles.
- **What never starts a chain.** A ruling, a reply, a delivery or a review.
- **Direct or heuristic.** These use O3's split. A hand-off is direct when it is recorded explicitly (a delivery linked by `msg_id`, a logged hand-off, a captured critic request or ruling), and heuristic otherwise. A loop is direct only when all its edges are.
- **Drawing.** Each loop is a chain of role boxes with a return arc and "×n: d direct, h heuristic". Click it to filter the floor.
- **Scope.** The view works on operations without a template (`work/…`) and on "all operations".

## D. Real data (read-only collect, temp server on 4320, now stopped)
- **Size:** 10,167 events and 43 operations, collected in about 1.4 s.
- **Role nodes and their sessions:**

  | Node | Sessions |
  |---|---|
  | **Partner** | `83d97c5f` (15:15) → successor `8ce255fe` → successor `9351fe45` |
  | **Operator** | `83d97c5f` (12:23–14:49) → `6d476469` |
  | **Secretary** | `f23b74aa` |
  | **Housekeeper** | `6d4c6f06` |
  | **Critic** | threads `01a15421` → successor `01a154a3` |

  The coordinator is `83d97c5f` until 12:06. Eight sessions from before 10-19 stay unregistered.
- **10-19 hand-offs (acceptance):**
  - secretary → operator (12:36), with the operator's reply (12:37);
  - **partner → operator brief (15:18)** and **operator → partner replies (15:24, 15:25, 16:50)**, all captured and delivered;
  - the 16:41 operator → partner send failed on a stale socket and shows red;
  - operator → housekeeper (16:46);
  - partner → housekeeper (16:49);
  - operator → critic ×3, NO-GO → GO;
  - partner → critic (16:49 NO-GO; 16:50 GO on `work/office`).
- **Loops on 10-19:**
  - Operator → Critic → Operator ×4 (heuristic: callers linked by launch);
  - Partner → Critic → Partner ×2;
  - Partner → Operator → Partner ×1 (direct);
  - Secretary → Operator → Secretary ×1 (direct).
- **Operations:**
  - `work/file-reorganisation` shows as "File reorganisation: from the old layout to ROOM.md's hierarchy", with its status line.
  - `work/office` shows as "The Office".
  - `2026-10-17/date` still renders its O3 workflow unchanged: 2 rounds, NO-GO → GO and NO-GO → NO-GO → GO, 5 unplanned.

## E. Tests
`npm run test:office` passes **51 of 51**: the 42 earlier tests plus 9 new ones in `office/test/office-o4.test.ts`. `npx tsc -p office` and `npx tsc --noEmit` are clean, and `npm run test:workbench` passes **150 of 150**.

| Test | What it proves |
|---|---|
| `privacy P1: …` | Section A. |
| `registry parsing and role resolution` | Both file formats. Malformed entries are skipped and counted, and invalid JSON is reported. Precedence is registry > title > primary > none, the first registration is retroactive and a later one applies from its `since`. Socket lookup works, and title-to-role edge cases are covered. |
| `register-session: …` | Covers refusals (unknown role, no session id: nothing written), append, idempotence and a role change, plus the exact entry format. No file is written outside `roles/` and no temp or lock file is left. A hand-kept file is never rewritten, and the shell entry point works end to end. Everything runs in temp dirs. |
| `sessions by role: …` | Registry- and title-named nodes; the fork listed as a successor session, its copied send counted once and its own tail attributed. A session renamed early has no leftover node, the unregistered fallback name is checked, and a delivery is not Deniz. |
| `messages between sessions: …` | msg_id-linked (captured), socket-resolved reply (derived) and delivery-only (derived) edges. Also covered: operation from named paths, exact edge labels and narration, the loop count and its direct/heuristic split, the PSRI loop, and the agent-written `summary` absent from every metadata route. |
| `research/: …` | Commission → PSRI and delivery → commissioner, with titles and the `research/<topic>` operation. |
| `work/<thing> folders are operations …` | README title, Work group, archive status line, old coordination operation still rendered, the `archive/coordination` fallback, env overrides. |
| `restricted/ under work/ …` | Before unmasking, every route and every Expand is checked, plus the manifest, driver-state and key file reads: no `·v[01]·`, rooms lettered. `work/..` is refused. After a valid `work/date-room` unmask the arms appear, and `restricted/` stays path-only. |
| `critic: …` | One node with no per-run nodes. Two threads listed as sessions, three rulings kept, and the captured caller (partner) versus the inferred fallback. The partner → critic → partner loop ×2 is direct. |

## Limits, and what is not done
- **Not done here** (release items): the Claude reviewer rerun and the critic's combined O3+O4 release review. The role files still need the `register-session` line (that is the partner's or coordinator's job, since `roles/` is read-only for me). Nothing has been registered yet, so today every role comes from Desktop titles (derived).
- **Title timing is approximate.** Desktop titles carry no timestamp, so a title change is placed at the previous timestamped record. A title is free text, so a session wrongly titled with a role name would be shown as that role, marked "by its Desktop title".
- **Sockets change on restart.** A send to a stale socket with no registry entry and no linked pair resolves to "not found".
- **Live tier.** Messages between sessions are linked on full collects. Until the next full collect (≤15 s, or ≤120 s while hooks deliver), a live hook `SendMessage` resolves by socket or name only.
- **Critic callers before this build** are linked by launch time (derived). From now on `office-codex` records the caller.
- **Research matching is by file name.** Commission and synthesis are told apart by file name, and the folder ties a synthesis to its commission. That convention needs confirming once A5 lands.
- **Loops are the greedy chain rule above.** Interleaved hand-offs of two separate threads between the same roles may pair differently than a human would; the split and the click-through to the events show what was counted.
- **Old `events.jsonl` names** (`claude-engineer`, `labelers`, …) remain `role:<name>` nodes from O1. They are not roles in the O4 sense.

## Review fixes (after the NO-GO on d3663e1 from the Claude reviewer and the Codex privacy reviewer)
These supersede the sections above where they differ. Tests: `office/test/office-o4-review.test.ts`, plus an updated edge-label test in `office-o4.test.ts`.

**Blinding.** While an operation has no valid unmask record, nothing may reveal which arm a room belongs to, or let it be inferred.
1. **Room records are path-only while masked** (Codex High, reviewer P1-a). This is `blindIndex` and `blindChecker` in `rooms.ts`, installed as `Allowlist.blind` by `collect()`.
   - **Which records:** the id set has three sources:
     - every record id named in a masked folder's driver, checkpoint and template files (`manifest-*`, `driver-state.json`, `checkpoint(s).json`, `*template*`, `*checkpoint*`);
     - every id in its `restricted/key.json`;
     - the closure of those ids over the `branches`, `revisions`, `turns` and `attempts` records they reach.
   - **Covered:** the branch → parent → checkpoint → template chain, and the checkpoint revisions whose `state.system` is the arm template.
   - **Content rule:** any `turns`, `attempts`, `outcomes`, `revisions` or `branches` record whose id is in the set, or whose content names an id in the set, is **path-only**. That includes records written later.
   - **Where it applies:**
     - `/api/expand/file`;
     - the room-feed Expand;
     - Read results of `.room-data` files;
     - shell outputs, because `verifyCommand` uses `allows()`;
     - hook and Codex spool sections that touch those paths, withheld on read because the hook has no index;
     - the manifest-turn Expand, which now shows the turn's shape and the room-message path only.
   - The driver, checkpoint and template files themselves are path-only too. Manifests stay readable as an internal source for the masked per-event Expand only.
   - Real data: 6 masked operations, 20 driver files and 7,579 record ids. The index takes about 1.5 s to build the first time, then it is cached on the driver files and the record directories, and rechecked at most once a second.
2. **Pattern masking as defence in depth.** While any operation is masked, `maskAll` also rewrites these tokens in every response to `x·arm-masked·y`:
   - any `x·vN·y` / `x·vN` token;
   - any token carrying an arm named in a masked folder's key (trajectory values, or `arm`/`condition`/`variant` fields).

   The one exception is an exact trajectory id of an operation that has a valid unmask record.
3. **The masker sees the collector's file set and fails closed** (P1-b).
   - `manifestsIn` and `opFolders` use the collector's own walk: any depth, skipping dot directories and `node_modules`.
   - The masked folders are every folder holding a manifest, plus every `coordination/<day>/<sub>` or `work/<thing>` that has a `restricted/` directory.
   - A trajectory the masker never learned is shown as `phase·pair·room ?`, and pattern masking catches it in text.
   - Tests cover `coordination/<day>/x/run/manifest-*.jsonl` and `work/thing/a/b/c/d/manifest-*.jsonl`.
4. **Order leak** (P3).
   - The driver creates rooms in arm order. While masked, their branch events therefore share one coarse time (the run's first branch), carry no manifest line numbers, and are emitted in an order seeded by the key's hash.
   - Lanes inside a pair are ordered by their seeded room letter. Fans carry no trajectory and no creation time.
   - Turn-completion order was checked on the real compare run and does not follow the arm: v0 finished first 94 times, v1 86.

**Labels and honesty**
5. **Unknown `events.jsonl` names** are now `actor:<hash8>`, labelled "unknown actor <hash8>". Only `WHO` names, the role list and `psri` are mapped; free text never becomes a label or a role node. Old names such as `claude-engineer` now show as unknown actors.
6. **Inter-session edges** show a topic only when the operation is explicit. An inferred operation is dropped, so the edge reads "asks Operator".

**Minor**
7. The unmask cache key now includes the current SHA-256 of the lock files that `unmask.json` names.
8. A critic request or ruling whose caller was linked by launch time is marked `callerLinked` and counts as a **heuristic** hand-off.
9. `allowsDir` applies the repo's excluded segments (`node_modules`, `.git`, `saves`, …, and `.env*`) under `work/` and `research/`, through the same check as `allows`.
10. Message bodies between sessions (`SendMessage` message and result, delivered bodies, and hook-spooled peer sends) are now prose: they show only on the third click.

**Known residue**
- The blind index and the operation-folder list are rechecked at most every 1–2 s. A brand-new masked folder could therefore be unprotected for up to about 2 s.
- Records that name a known masked id are always checked on read.

**Results:** `npm run test:office` passes 56 of 56 (5 new tests). `npx tsc -p office` and `npx tsc --noEmit` are clean, and `npm run test:workbench` passes 150 of 150.

## Review fixes, round 2 (after the recheck of 599f02b)
1. **No cache window** (Codex High).
   - The 2 s folder list and the 1 s blind index are gone.
   - Before every `/api/*` response, and before every SSE push, the server runs `refreshBlind`. This is a synchronous layout check over:
     - the mtimes of every directory under `coordination/` and `work/`, which change when a folder, a `restricted/` dir or a file appears;
     - the size and mtime of every manifest, driver, template and `restricted/` file of the known operation folders.
   - If anything is new or changed, the folder list and the index are rebuilt before the answer. The folder list now lives in that state, so `opFolders` and `maskAll` use it too.
   - **Room records not yet classified:** a `.room-data` record newer than the index is path-only while any operation is masked. When only record directories have changed (no new folders or files), the index is rebuilt at most every 30 s, and those records stay masked until then.
   - **Cost on real data:** the check takes about 6 ms per request, and a full rebuild about 1.6 s.
   - **Test:** `no cache window: …`. A masked folder is created between two requests on the same server. On the second request:
     - the room record is path-only;
     - the manifest is path-only;
     - the arm is masked in text;
     - a record written after the index was built is masked.
2. **Masked per-turn driver events** (reviewer recheck: in the real compare run, v0's request goes out 1–5 ms earlier and on a lower line in all 180 pair-turns).
   - While masked, `intent` (dispatch) and `done` events are held back, like the creation events. Requests get one coarse time per pair and turn: the earliest request in that pair-turn.
   - All per-room driver events lose their line numbers, and members of a pair are emitted in an order seeded by the key's hash. Completion times are kept, since they don't follow the arm.
   - Masked driver events expand to "driver record: masked until a valid unmask record". Fans link ticks to masked turn events by turn id.
   - Real data: all 360 compare requests share their pair's time and have no lines.
   - **Test:** `blinding recheck: …`. The fixture uses the real driver order (v0 first, 2 ms earlier, lower line). It checks that:
     - no masked per-room event carries a line number;
     - both requests of every pair-turn share one time;
     - the response order equals the seeded order;
     - v0 comes first in some groups and not in others, so the order does not follow the arm.

**Results:** `npm run test:office` passes 58 of 58, `npx tsc -p office` and `npx tsc --noEmit` are clean, and `npm run test:workbench` passes 150 of 150.
