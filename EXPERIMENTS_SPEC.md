# Branch changes and experiments — specification

Status: v0.1 built (commit 5c00b94) · §6–§11 ready to build · Version 0.2 · 24 September 2026
Companion to `PRODUCT_SPEC.md` (§4.4 branching, §4.8 experiments). Read `CLAUDE.md` first; its invariants apply to everything below.

## 1. Problem

Deniz ran a 15-trial experiment: one fork point (game 2, just before Alexandra's Day 2 vote), three conditions that each changed one line of the shared rules, and five trials per condition. Reading the result meant opening 15 branches and scrolling through prompt panels to find what differed, even though the app already knew exactly what differed.

This spec adds two independent features:

- **A. Branch changes** — every branch shows what differs from the state it was forked from. Always useful, small, build first.
- **B. Experiments** — a first-class record that groups many trial branches under one question, shows each condition once as a diff against the control, and presents the results as one table. For batches.

A does not depend on B. B reuses A's diff.

## 2. Feature A — Branch changes

### 2.1 What is compared

A branch's **fork revision** (`branch.fork`) is its starting state. Its **head revision** is its current state. The changes are the difference between the two `State`s, split into:

- **Settings changes**, one entry per changed field:
  - `system` (shared instructions)
  - `human` (human's display name)
  - `participants` (added/removed names)
  - `shadow`, `policy`
  - per character: `prompt`, `memory`, `provider`, `model`, `temperature`
- **Conversation changes**, by message `id`:
  - `appended` — messages after the fork revision's last message, counted by source (`generated`, `human`)
  - `edited` — same position, new id with `source: 'edited'`, or same id with different text
  - `removed` — ids present at the fork revision and absent now
  - `inserted` / `reordered` — detected by id order

Branches with no fork revision (originals) have no changes section.

### 2.2 Server

New module `src/workbench/changes.ts`, exporting:

- `lineDiff(a: string, b: string)` → `Array<{ op: 'same' | 'add' | 'del'; text: string }>`: a line-level LCS diff. No new dependencies. Inputs are prompts and rules, under 100k characters. An O(n·m) table is fine up to ~2,000 lines per side; beyond that, fall back to showing the whole field as replaced.
- `stateChanges(from: State, to: State)` → `{ settings: SettingChange[]; conversation: { appended: Record<string, number>; edited: string[]; removed: string[]; inserted: string[]; reordered: boolean } }`.
  - `SettingChange` is `{ field: string; character?: PersonaName; before: unknown; after: unknown; diff?: LineDiff }`.
  - `diff` is present for string fields longer than one line.

New endpoint `GET /api/branches/:id/changes` → `{ fork: { branch, revision } | null, changes }`. It computes from stored revisions on each request; nothing new is persisted. Diffs are derived views, not evidence.

### 2.3 UI

- **Badge.** In the branch picker, the branch navigation and the pane header, show a compact summary. Examples: `rules −1 line`, `Alexandra memory edited`, `model changed ×8`, `+3 messages`, `retcon: 1 edited`. Settings changes come first; conversation changes after. Show at most three items, then `+N more`.
- **Changes panel.** Clicking the badge opens a changes panel in the right-hand sidebar, alongside Characters / Inspect / Notebook:
  - Each changed field gets a header (`Shared instructions`, `Alexandra · personality`, …).
  - Long text fields show a unified diff: unchanged runs of more than 3 lines collapse to `… 24 unchanged lines …`, which expands on click. Deleted lines are red, added lines green, each marked `−`/`+` as well, not by colour alone.
  - Short fields show `before → after`.
  - Model and provider changes applied to many characters with the same before/after collapse into one line: `model: moonshotai/kimi-k3-ultrafast → deepseek/deepseek-v4.1-flash-ultrafast (8 characters)`.
- **Comparisons.** Each pane header shows its branch's badge. A **Diff these panes** button shows `stateChanges(left head, right head)`: the two branches compared directly rather than each against its own fork.

### 2.4 Related fix

Comparison snapshots created by `comparisons.ts` reuse the source branch's name exactly, so the branch list shows duplicate names. Name them `<source name> · compare copy`.

### 2.5 Acceptance

- Open any `Exp1 · B_no_brevity · trial N` branch. The badge reads `rules −1 line` plus `+1 message`. The panel shows the removed line `- Keep replies short, like speech around a table: a few sentences.` and nothing else under Shared instructions.
- A `C_show_deduction` trial shows the voting rule as one deleted line and one added line.
- Game 2 (an original) shows no changes section.
- A retcon branch lists its edited message.
- Tests (in `tests/workbench.test.ts`):
  - `lineDiff` on insert/delete/replace.
  - `stateChanges` for each field type, including appended and edited messages.
  - The endpoint returns `fork: null` for originals.

## 3. Feature B — Experiments

### 3.1 Records

Stored with the existing `Store`. These are new kinds, append-only like every other research record.

**`experiments/<id>.json`**

```ts
{
  id, name, createdAt,
  question: string,            // what is being tested
  prediction: string,          // what result would support / refute it
  base: { branch: string; revision: string },   // shared fork point
  speaker: PersonaName,        // who takes the measured turn
  conditions: Array<{
    key: string;               // 'A_control'
    label: string;
    control?: boolean;         // exactly one condition is the control
    patch: Partial<Pick<State,'system'|'participants'|'shadow'|'policy'|'human'>> & {
      characters?: Partial<Record<PersonaName, Partial<Character>>>
    };
  }>,
  outcome?: {                  // optional automatic labelling of each reply
    pattern: string;           // regex source, first capture group is the outcome, e.g. "I vote\\s+\\**([A-Za-z]+)"
    flags?: string;            // e.g. "gi"; the last match wins
    highlight?: Record<string, string>;  // outcome value → tag, e.g. {"Elorin":"wolf","Ceryn":"wolf"}
  },
  lockedAt?: string            // set when the first trial runs
}
```

**`experiment-trials/<id>.json`** — `{ id, experiment, condition, index, branch, turnId, at, status }`, where `status` is `completed`, `failed` or `canceled`.

**`experiment-labels/<id>.json`** — `{ id, trial, outcome, tag?, note?, at }`. A manual override of the extracted outcome. Append-only; the latest one per trial wins. The extracted value stays visible next to it.

Observations (`observations`) gain an optional `experiment` field, so notes attach to an experiment.

**Pre-registration.** Once `lockedAt` is set, `question`, `prediction`, `base`, `speaker` and `conditions` are frozen. Later thoughts go in observations. This keeps the record honest about what was predicted before the data came in.

### 3.2 Running trials

`POST /api/experiments/:id/run { perCondition: number (1–50) }`

- An explicit user action. The UI shows the call count (`conditions × perCondition`) and each condition's provider/model before confirming. Nothing runs automatically.
- For each trial:
  1. Fork `base.revision` with the name `<experiment name> · <condition key> · trial <n>`, tagging the branch with `experiment: <id>`.
  2. Commit the condition's `patch` onto the forked state with the reason `Experiment condition <key>`.
  3. Take one `forced` turn by `speaker`, using the normal `Engine.turn`. The selection is recorded as `forced` with `run: { id: <experiment id>, index, count }`.
  4. Write the trial record.
- Conditions run in parallel; trials within a condition run in sequence. That matches the concurrency Exp1 used and keeps provider load bounded.
- **Timeouts:** retry a timed-out turn up to 2 times on the same branch. Every attempt stays recorded, as it does today.
- **Stop:** cancels the remaining trials and aborts in-flight turns. A partial run is a valid result.
- **Resume:** running again continues numbering from the highest existing index per condition.

`POST /api/experiments` creates an experiment. `POST /api/experiments/:id/attach { condition, branch, turnId? }` attaches an existing branch as a trial. Use it to backfill Exp1 (§3.5) and for trials run outside the app.

### 3.3 Experiment page

A third sidebar tab, **Experiments**, next to Conversations and Comparisons. The page has these sections:

1. **Header.**
   - The name, question and prediction, with a `pre-registered <time>` marker once locked.
   - The base: a link to the fork point, showing its last message as context.
2. **Conditions.**
   - Each condition as a card.
   - The control card shows its patch as plain values.
   - Every other card shows only its diff against the control's effective state (reusing Feature A's diff rendering), so each card shows the one line that changed and nothing else.
3. **Results summary.**
   - Per condition: counts of each outcome value (for example `Jonas 5` / `Jonas 2 · Rook 1 · Elorin 1 · Ceryn 1`), and counts per highlight tag (`wolf 0/5`, `wolf 2/5`).
   - Show counts only, never a combined score (PRODUCT_SPEC §4.8). Show `n` prominently.
   - Show a small-sample note when `n < 10` per condition.
4. **Trials table.** One row per trial:
   - Condition and trial number.
   - The outcome: the extracted value, a manual label if one exists, and a highlight tag chip.
   - The first ~160 characters of the reply, with the full reply shown on expand.
   - A **Reasoning** expander (§3.4).
   - Latency and tokens.
   - Links: open the branch, and Inspect.

   The table can be filtered by condition and tag, and sorted by any column.
5. **Notebook.** Observations attached to this experiment.

### 3.4 Reasoning display

Add `reasoningOf(outcome)` in `generation.ts`. It parses `outcome.raw` and returns `choices[0].message.reasoning_content` when present. Use it in:

- The trial table's Reasoning expander, rendered as readable text.
- The regular Inspect panel, as a **Reasoning (as returned by provider)** section between the dispatched request and the raw response.

Label it as provider-returned text, not a view into the model's internal process (PRODUCT_SPEC §4.3). Never feed it back into any model context.

### 3.5 Acceptance

**Backfill Exp1** through the API, with no provider calls:

- **Base:** branch `be558803-0a09-4937-813c-19d4b83414cb` (Werewolf · game 2), revision `1f7b27db-fd88-4851-8d19-89d69074b226`. The speaker is `Alexandra`.
- **Conditions:**
  - `A_control`: `system` equal to the base rules.
  - `B_no_brevity`: the base rules minus the line `- Keep replies short, like speech around a table: a few sentences.`
  - `C_show_deduction`: the base rules with the voting line replaced by `- When the Moderator asks for your vote, first state the deduction behind it in one or two sentences, using what is known (revealed roles, who voted for whom), then name exactly one living player in the form "I vote <name>."`
- **Outcome:** pattern `I vote\s+\**([A-Za-z]+)`, highlight `{"Elorin":"wolf","Ceryn":"wolf"}`.
- **Trials:** attach the 15 branches named `Exp1 · <condition> · trial <n>` whose parent is game 2. Exclude the two `Comparison snapshot` copies.

The page for the backfilled experiment must show:

- Condition B's card with exactly one red line.
- Condition C's card with one red and one green line.
- The summary `A: Jonas 5 · wolf 0/5`, `B: Jonas 4, Rook 1 · wolf 0/5`, `C: Jonas 2, Rook 1, Elorin 1, Ceryn 1 · wolf 2/5`.
- Reasoning readable for every trial.

**Run a new experiment from the UI** against a demo-provider room: 2 conditions × 2 trials.

- Trial branches, selections (`forced`, with run info) and trial records exist.
- Stop mid-run leaves completed trials intact.
- Editing `prediction` after the first trial is rejected.

**Tests**, using mocked transports and never live keys:

- Patch application.
- Outcome extraction, including the last match winning.
- The lock rule.
- `attach`.
- Resume numbering.
- `reasoningOf` on responses with and without `reasoning_content`.

## 4. Out of scope

- Blind comparison (hiding condition labels until judged), statistical tests beyond counts, multi-turn probes (more than one measured turn per trial), and automatic experiment design. These are Release 3 items in PRODUCT_SPEC and can build on these records later.
- Changes to the Discord code.

## 5. Build order

1. `changes.ts` with tests, then the endpoint.
2. The branch badge and changes panel, plus the comparison-copy naming fix.
3. `reasoningOf` and its Inspect section.
4. Experiment records, create/attach, and the Exp1 backfill.
5. The experiment page.
6. Run/stop/resume from the UI.

Update `WORKBENCH.md` after steps 2, 5 and 6.

---

# Version 0.2 additions

Background: Exp2 (a 20-trial replication of Exp1 A vs C) found no wolf votes in either condition, against 2/5 in Exp1's C. The dispatched requests were byte-identical; what differed was provider-side. The model generated about half as many completion tokens (median 815 vs 1,413 in C). Pooled over 50 trials, every run under 900 completion tokens voted with the pile, and both wolf votes came from runs over 1,300. Two consequences follow:

- Reasoning length must be visible per trial.
- It must be controllable where the provider allows.

Probing OpenGateway (`deepseek/deepseek-v4.1-flash-ultrafast`, 24 Sep 2026):

- `reasoning_effort` and `reasoning.effort` are accepted but have no measurable effect. Low and high gave the same token counts over 4 repeats each, and an invalid value is accepted silently.
- `thinking: {"type": "disabled"}` works: it returns no `reasoning_content`.

## 6. Fixes from the v0.1 test run

1. **Base-context excerpt.** It starts mid-word ("Elorin: ed isn't a bad read…"). Show the last one or two whole messages before the fork point, truncated at the end, never the start.
2. **Sidebar refresh.** The Experiments sidebar doesn't refresh after an experiment is created; it only appears after a reload. Refresh the list and open the new experiment.
3. **Condition-key validation.** The input's `pattern="[A-Za-z0-9_-]+"` is invalid under the browser's `v`-flag compilation (a console error, and validation is silently skipped). Use `[A-Za-z0-9_\-]+`.
4. **Base-conversation dropdown.** It lists branches in ID order. Group by original conversation (originals first, their branches indented beneath), sort by name within each group, and preselect the conversation currently open.
5. **Change badge.** It wraps into four lines inside the button column. Put it on its own line under the room title instead.
6. **Clipped buttons.** The "Branches" navigation button is clipped at the right edge at ~1024px width. The header actions must wrap rather than overflow.

## 7. Per-character reasoning setting

- `Character` gains an optional `reasoning: 'default' | 'off'`. Absent means `default`. It is validated in `validateState`.
- In `generate`, when `reasoning === 'off'`, the provider mapping adds the provider's documented switch to the request body:
  - **`opengateway`:** `thinking: { type: 'disabled' }` (verified above).
  - **`together`:** reject `off` with a validation error until a switch is verified against Together's API. Never send an unverified parameter silently.
  - **`demo`:** accepted, and it changes nothing.
- The parameter is part of `body`, so it is persisted in the attempt before dispatch, like every other request field.
- Don't offer effort levels. None had a measurable effect on the only provider tested. Add them later only per provider, after a probe shows they change token counts.
- **UI:** a "Reasoning" select in character settings (`Provider default` / `Off`). The "apply provider/model to all characters" action carries it too.
- **Changes view:** `reasoning` is a character field like `temperature` (`Boris · reasoning: default → off`).
- **Experiments:** allowed in condition patches (`characters.<name>.reasoning`).

## 8. Branching experiments

A locked experiment never changes. To vary it, branch it.

- **Record.**
  - `Experiment` gains `parent?: string`, the ID of the experiment it was branched from.
  - `POST /api/experiments/:id/branch { name }` creates a new **draft**. It copies `base`, `speaker`, `conditions` and `outcome`, sets `parent`, and leaves `question` and `prediction` empty so they are written fresh. The parent is untouched.
  - The draft is then edited normally and locks on its first run, as usual.
- **Linking existing experiments.** Lineage is metadata, not design. For experiments that were created independently (Exp2 was a manual branch of Exp1), `POST /api/experiments/:id/link { parent }` writes an append-only `experiment-links` record. It is allowed on locked experiments, because it doesn't change the frozen design. The effective parent is `parent`, or failing that the latest link. Reject cycles.
- **Design diff.** The child's page shows "Branched from <parent>" with a diff of the designs:
  - `base` changed (with both checkpoints' last messages).
  - `speaker` changed.
  - Conditions added, removed, or with changed patches (reuse `stateChanges`/`lineDiff` on the effective condition states).
  - Outcome rule changed.
- **Lineage view.** On any experiment page, show the family, parent above and children below, as a compact table:
  - Name, locked date, trials per condition.
  - Each condition's outcome counts and tag counts (e.g. `wolf 2/5`).
  - The median completion tokens per condition.
  - A link to each experiment.
  - Conditions with identical effective state across experiments share a row label, so replications line up.
- **No automatic pooling.** Never merge counts across experiments, even when designs are identical. Exp1/Exp2 showed the provider can drift between runs with no change on our side. Show each experiment's run window (first and last trial time) next to its counts.

## 9. Reasoning length in results

- **Trials table:** add columns for completion tokens (`usage.completion_tokens`) and reasoning characters (length of `reasoningOf(outcome)`). Include `usage.completion_tokens_details.reasoning_tokens` when the provider supplies it.
- **Results summary:** per condition, show the median and range of completion tokens beside the outcome counts.
- **Filter:** add a filter/sort on completion tokens, so a pattern like "short runs always join the pile" is visible without scripts.

## 10. Acceptance for v0.2

- The six fixes in §6 are visible in the UI. The console is clean on the experiment form.
- **Reasoning off:**
  - A character with `reasoning: 'off'` on OpenGateway produces a dispatched body containing `"thinking":{"type":"disabled"}`, verified with a mocked transport. Tests never make live calls.
  - With `together` it fails validation before dispatch.
  - The changes view and condition cards show it.
- **Branching:**
  - Branching Exp2 yields a draft whose conditions equal Exp2's, with `parent` set and an empty prediction.
  - Changing C's patch to `characters.Alexandra.reasoning: 'off'` shows exactly that in the design diff.
  - Exp2's page is unchanged.
- **Linking:** linking Exp2 to Exp1 (`POST /api/experiments/<Exp2>/link { parent: <Exp1> }`) makes Exp2 show "Branched from Exp1". Its design diff shows condition `B_no_brevity` removed and nothing else. The lineage view lists Exp1 (5/cond) and Exp2 (20/cond) with separate counts, run windows and median tokens.
- Tests cover patch copying on branch, cycle rejection on link, the reasoning validation per provider, and the request-body mapping.

## 11. Build order for v0.2

1. §6 fixes.
2. §7 reasoning setting (engine, generation, validation, UI, tests).
3. §9 reasoning-length columns.
4. §8 branching and linking, then the lineage view.

Update `WORKBENCH.md` after steps 2 and 4. The first experiment planned on top of this: branch Exp2 → Exp3, with C = control rules plus `Alexandra.reasoning: 'off'`, 20 trials per condition.
