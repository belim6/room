# Room workbench

For a consolidated, code-audited description of implemented behavior as of 2 October 2026, see [Current capabilities](CURRENT_CAPABILITIES.md). This guide includes older incremental notes; the capabilities specification resolves their known conflicts.

Start from the project directory:

```sh
cd /Users/denizyuksel/dev/room
npm run workbench
```

Open http://127.0.0.1:4317. Requires Node 22 and the project's installed dependencies. No new packages were added. `npm run discord` runs the existing Discord frontend separately; `npm start` still targets the older application and is not the workbench command.

## First conversation

1. Create a room, empty or from a room template (see **People and the vault** below). An empty room has nobody in it: use **Add person** in Characters, then Continue. People are added with **OpenGateway** and `deepseek/deepseek-flash` by default, so Continue makes a real, paid request. **Local demo** (placeholder replies, no model calls) is only offered on instances started with `ROOM_DEMO=1`, meant for throwaway test instances. Elsewhere, rooms saved with demo characters stay readable and editable, and their Characters panel says to pick a provider; a demo character cannot generate there until switched.
2. In Characters, select a person, choose a provider and exact model ID, then save. “Apply provider/model/reasoning to all characters” applies these settings, temperature and the reasoning setting across the cast while preserving their different prompts and memories.
3. For OpenGateway, the existing `.env` key and Kimi model are supported. For Together, add `TOGETHER_API_KEY=...` to `.env`, restart, and enter an available model ID. Credentials are never entered in the browser.
4. Send your message, then Continue. Select a person or random selection; optionally request up to 20 turns. Every Continue is a recorded run (see **Runs**). Stop ends the run for good and cancels the active request. Aborting locally cannot guarantee the provider stops processing or charging.
5. Inspect any reply to see its request, raw response, processing, and selection. All attempts also includes failures and rejected replies.

Together's chat integration follows its [official chat completions API](https://docs.together.ai/reference/chat-completions), checked 22 September 2026. Inference integration has been tested with mocked responses, not a live Together key. No training or hosting jobs are submitted by this version.

## Branch and retcon

- **Branch** copies the current state. **Branch here** copies the earliest stored state containing that message, including the prompts and memories at that point.
- **Retcon** rewrites/removes a message in the current branch, preserving the prior revision. Branch first if you want a separate continuation. Regenerate mode removes later messages and restores historical settings; keep mode preserves later messages and current settings. Memory can independently be restored to the edit point or retained as a deliberate intervention.
- “Regenerate” prepares the new continuation; it does not automatically spend money generating replies. Click Continue afterward.
- **Edit history** opens an editor for inserting, changing, removing, and reordering messages. It saves a revision in the current branch with current prompts and an explicit choice to keep or clear memories.
- Edit personality instructions, shared instructions, and memory within the new branch via Characters. These changes never overwrite earlier revisions.
- **Compare** displays two continuations side by side.

Kept messages retain their original generation IDs. Their inspector shows the original request, never a reconstruction using the retconned history. Imported saves lack historical intermediate memory; any restored state can only use what the save actually supplied. Inspecting an imported message displays this limitation.

## Jev

Jev is **opt-in shadow only** in the browser. With `TYPESAFE_API_KEY` configured, enable it in Characters. Each generated turn starts an independent observation against the frozen pre-turn context. It never delays generation, selects a speaker, triggers research, or enters character context. Requests, instruction hashes, probability outputs, failures, and timing appear in Inspect; use Refresh if a result arrives after the character's reply.

The original Discord Jev modes are unchanged. Browser advisory/control modes, calibration, and learned selection policies are not implemented yet. No paid shadow calls were made during development.

## Evidence, memory, and storage

`.room-data/` contains local JSON records and is ignored by Git. Set `ROOM_DATA_DIR` to use another directory and `ROOM_PORT` to choose another port. Run one workbench process per data directory. Use `npm run backup` (see **Backup and restore**) rather than copying the directory by hand.

- State revisions and requests are immutable records; branch head files point to the current effective state.
- Each request is persisted before dispatch. A separate outcome records raw response, transformations, validation, usage, finish reason, timing, and errors.
- Interrupted browser attempts are marked on restart and never retried automatically.
- A response arriving after a branch edit is retained as detached evidence and not appended to the edited conversation.
- Memories are manual in this version. Future-self notes generated by models are captured in attempt outcomes but not automatically applied to browser characters.
- Notebook observations are never model input. JSON export includes research evidence; Markdown export includes observations.
- Legacy saves import as separate rooms without modifying the source. Missing historical prompts and settings are explicitly unknown; current defaults provide a starting configuration. Recognized Kimi assignments are mapped; the original save is retained in the import record.
- Discord's `respondAs` keeps its string return for caller compatibility, but now uses the same durable generation recorder. Discord attempts are on disk; the browser only lists its own branch-linked attempts. Existing Discord routing logs remain separate.

The local server binds only to loopback and rejects foreign Host/Origin headers. Exported request records omit authorization headers. Saved conversations and prompts remain private local files; model generation sends the effective prompt to the selected provider.

## Verification and remaining scope

```sh
npm run test:workbench
node tests/participants.test.cjs
npx tsc --noEmit
```

Tests cover request-before-dispatch persistence, rejected retries, raw responses, limits, failures, branch/memory isolation, stale edits, cancellation, detached results, nonblocking shadow observation, import/export, and local HTTP boundaries. Browser checks cover creating a room, messaging, demo generation, inspection, retcon, and comparison.

This is the first usable conversation/research loop, not all four releases in PRODUCT_SPEC.md. Dataset curation and training jobs, blind/scored comparison batches, character-specific histories, automatic memory generation, and browser tool/research calls remain later work. Storage currently uses atomically written JSON files instead of the spec's proposed SQLite; this keeps the initial single-user record inspectable without a database dependency.


## Independent comparisons and branch library

The sidebar has **Conversations** and **Comparisons** tabs. Conversations lists originals only. Open an original and use **Branches** to choose any descendant, including older retcon branches; nested branches stay associated with their original conversation. The **← / →** arrows beside Branches move through that family directly: original first, then branches by creation time. The counter shows your position, and arrows disable at either end. In comparisons, each pane has its own arrows; changing one side leaves the other side alone and marks the pairing unsaved. Use Save comparison to keep the new pairing.

**Compare** creates independent snapshots of the selected conversations and opens them in two panes. Copies include history, prompts, memories, participants, and provider settings. Even before saving, changes in either pane do not affect its source conversation. Each has its own message composer, speaker selection, turn count, Continue/Stop, Branch, Edit history, and Characters & settings controls. Inspect and notebook actions target the clicked pane. Both sides can generate concurrently; stopping one side does not stop the other. Editing history or branching replaces only that pane with the newly created branch.

**Save comparison** names and saves the independent pair in the Comparisons category. Later changes to source conversations do not enter the comparison; only changes made within its own panes do. Comparison copies and their branches stay out of the Conversations library. Changing which branch a pane displays marks the pairing unsaved; use Save comparison to retain that change. Existing conversation and research data are never deleted by saving a comparison.

**Branch comparison** creates independent copies of both sides at their current states and saves a child comparison. Subsequent history, prompts, memory, or generations in the copied pair do not alter its parent comparison. Save any changed pairing and stop active turns before using this button.

## Delete and restore conversations

Open a conversation and click **Delete conversation** to move it and all its branches to **Trash**. Within a branch, **Delete branch** moves just that branch and its descendants. Stop any active generation in the affected branches first.

Use **Trash → Restore** to recover the deleted conversation or branch. If a branch was deleted separately before its parent, restore the parent first, then restore that branch separately. Saved comparisons have independent copies, so deleting a source conversation does not remove its comparisons.

Deletion removes conversations from the active library, not from disk. Messages, revisions, attempts, observations, and imported saves remain intact. Trash changes are recorded atomically, so a whole subtree is hidden or restored together. There is no permanent-delete action in this version.

### Existing comparisons

Legacy comparisons are converted once from live links to owned copies when listed/opened. Conversion preserves their current committed contents, original pairing history, and revision ancestry. Earlier generations were not tagged with their UI origin, so conversion does not try to reconstruct the original save boundary or remove externally added messages retroactively.

### Delete messages

Each message has **Delete message**. It removes that message from the current conversation or comparison pane, without making a new branch. Later messages and memories are retained. Future requests use the remaining history; prior attempts and immutable revisions are unchanged. Use **Inspect → Deleted messages → Restore message** to recover a deleted message, including its original identity and generation link. Stop generation before deleting or restoring messages.

## Read Jev observations inline

Turn on **Show Jev observations** above the conversation to show saved observations beneath messages, in either a single conversation or both comparison panes. This display preference is remembered locally and is separate from enabling new shadow requests in Character settings. Viewing or refreshing observations only reads saved records; it makes no model calls.

Each observed turn shows Jev’s suggested speaker, ranked speaker probabilities, its separately reported confidence score, the external-research probability, and the actual selection with its selection method. These describe the context **before** the reply, not an assessment of the reply itself. Edited messages are labeled as referring to their original turn. Messages without an observation show that explicitly; missing scores are unavailable rather than zero. Pending results refresh briefly in the background; use **Refresh observations** to retry manually. Raw records remain under Inspect.

## Branch and link experiments

A pre-registered experiment never changes. To vary one, open it and click **Branch experiment**. This creates a new draft that copies the checkpoint, measured speaker, conditions and outcome rule. The question and prediction start blank, so they are written fresh, and **Run** stays disabled until both are filled in via Edit design. The parent is untouched, and branching makes no model calls.

For experiments created independently (Exp2 was a manual copy of Exp1), use **Link parent** to record where one came from. A link is a separate append-only record, so it is allowed on locked experiments. A later link replaces an earlier one, and links that would form a cycle are rejected. Branched experiments keep the parent they were branched from and cannot be relinked.

A child experiment's page shows **Branched from <parent>** with the design difference: checkpoint, speaker, conditions added, removed or changed (as a settings diff of each condition's effective state), and the outcome rule. The question and prediction are not part of this diff.

**Lineage** lists the whole family: ancestors, the experiment itself, and all descendants. Rows are grouped by identical effective design (speaker plus the state after the condition's patch), so replications line up. Each row shows n, outcome counts, tag counts, median and range of completion tokens for the measured reply, and the run window. Counts are never pooled across experiments.

## Reasoning setting

Each character has **Reasoning** in Characters: `Provider default`, `Off`, or `Simulated` (generated private note). Off adds the provider's documented switch to the request, which is saved with the attempt before it is sent. On OpenGateway that switch is `thinking: {"type": "disabled"}`, verified on 24 September 2026 against `deepseek/deepseek-v4.1-flash-ultrafast` and on 30 September 2026 against `deepseek/deepseek-flash`. Since 30 September 2026, `v4.1-flash-ultrafast` returns no reasoning with any setting (it behaves like `deepseek-flash` with thinking disabled). Rooms created before then still name it, so switch them with **Apply provider/model/reasoning to all characters** if they should reason. Together has no verified switch yet, so Off is rejected for Together characters before anything is sent. Effort levels are not offered: on the only provider probed, they were accepted but made no measurable difference.

Simulated disables native thinking with the same verified switch as Off, then appends this frozen v1 paragraph after the frame's turn instruction:

> Before your message, write a brief private note to yourself between <think> and </think>: what you notice right now, what you want, and what you'll do. Nobody else sees this note. After </think>, write only your message.

Only providers with a verified Off switch accept Simulated (OpenGateway and local demo; Together is rejected). Exactly one leading `<think>…</think>` block and a nonempty public reply are required. Missing, unclosed, nested or extra delimiters reject the whole output. Format errors get one corrective retry, sharing the same two-attempt allowance with wrong-speaker errors; even Observe mode rejects malformed notes. Experiment timeout retries remain limited to three tries per trial.

The note is extracted before memory-note processing, speaker checks and the 2,000-character public reply limit. Outcomes retain `generatedNote` separately from provider reasoning; attempts record `simulatedReasoning: {version: 'v1'}`. Inspect labels it **generated private note**. It is never carried into character or Jev context, memory or conversation exports. Full research JSON includes the note, raw response and linked attempt provenance. Provider reasoning metrics still measure only provider-returned reasoning. An absent setting remains Provider default.

Reasoning appears in the branch changes view like any other character field (`Boris reasoning changed`), and experiment conditions can set it with `characters.<name>.reasoning` in the JSON patch.

## Reasoning length in experiment results

The trials table has **Completion tokens** (for the measured reply; the provider's reasoning-token count is shown underneath when it reports one), **Reasoning chars** (length of the provider-returned reasoning) and **Total tokens** (all attempts for the trial). All three can be sorted. The completion-token min/max filter narrows the table, for example to check whether short runs always vote with the pile. Each condition's result card shows the median and range of completion tokens.

## Favorites and Back

Each reply has **☆ Favorite** and **Dislike**. Click again to clear. A mark belongs to the message itself, so it follows the reply into every branch that keeps it, and it appears as ★ or ✕ next to the outcome in experiment trial tables. Marks are append-only records (`reactions/`): clearing or switching adds a new record, and the latest one wins. They are research material and never enter model context.

The sidebar's **★ Favorites** and **✕ Dislikes** tabs list every marked reply, newest first, with speaker, opening text, branch and time. Clicking one opens its branch, scrolls to the reply and shows it in Inspect. Replies whose branch is in Trash are listed but disabled. **Export favorites/dislikes (JSON)** downloads each marked reply with its written speaker label, its resolved identity (`speakerRef`, the label at that revision) and lineage (`branch`, `revision`, root conversation; person identities only mean something within one lineage), its text, full mark history and generation attempts (request, raw response, provider reasoning). A branch's JSON export also includes the mark history for its messages.

**← Back** (above the room title) returns to the previous conversation, saved comparison or experiment page, for example from a trial branch to its experiment. Browser back, mouse back buttons and swipe gestures do the same. Unsaved comparison drafts are not recorded as a step.

## Experiment workspaces

Running an experiment no longer adds branches to the conversation it samples from. On its first run, an experiment gets one isolated copy of its checkpoint, `<experiment name> · workspace` (parent none, forked from the original checkpoint revision, tagged `workspace`), and every trial branches from that copy. The workspace is recorded in `experiment-workspaces/<experiment id>.json`. That is a separate record rather than a field on the lock, because experiments locked by retrospective attachment already have a lock. The design still points at the original conversation and checkpoint, so the design diff and lineage are unaffected. A branched experiment gets its own workspace. Workspaces and trials never appear in the Conversations list.

Trials from before this change (Exp1–Exp3) keep their original parent, because branch records are evidence. Conversation views instead skip any branch that is an experiment trial, whether it was tagged at run time or attached retrospectively: the sidebar count, the Branches picker and its ←/→ steps. The picker has **Show experiment trials (N)** to put them back. All trials stay reachable from their experiment pages.

## Experiment and comparison families

The Experiments and Comparisons sidebars list only roots: experiments with no parent or link, and comparisons that weren't forked from another. Each shows `· N branches` for all its descendants. Once one is open, the header shows **← Family i/n →** and a picker listing the family as an indented tree (root first, children under their parents, by creation time). The sidebar keeps the root highlighted while you move around the family. The lineage table on experiment pages is unchanged; the navigator is for moving between experiments, and the table is for comparing their results.

## Harness framing

Besides the personality and room instructions, every request carries framing written by the app: an identity line at the end of the system prompt ("Your identity for this request is …"), a header in front of the quoted conversation, a line used when the conversation is empty, and the turn instructions with the participant list at the end of the user message. **Characters → Shared context → Harness framing** shows all four as editable templates, with the placeholders `{speaker}`, `{participants}` and `{transcript}` (the quoted conversation).

Blank a box to leave that part out. With a custom frame, empty parts are dropped rather than joined with blank lines, and if the system prompt ends up empty, no system message is sent at all. A room whose framing matches the defaults stores no frame and sends exactly the requests it sent before. Experiment conditions can set it with `frame` in the JSON patch (all four keys). The 2,000-character reply cap is still enforced after generation even if its instruction is removed.

## Back-and-forth

When a room has exactly two participants, **Back-and-forth** appears next to Turns. With it on, a multi-turn run alternates. The first turn goes to the selected voice, or to the one who didn't speak last if Random is selected. Every later turn goes to whichever of the two didn't speak last, and your own messages don't count. The first pick is recorded as usual (`forced` or `random`). Later picks are recorded as `random` with a single eligible speaker, and every turn's run info carries `mode: "alternate"`, so the rule is visible in the selection record.

## When you are in the room

Characters are told who is present through a roster line in each request ("Current participants: …"). You (the human name in Settings) are in that roster only once a message under your name exists in the conversation. Until then, characters are told only about each other. Rooms where you have already spoken, including every experiment base so far (where the human is the Moderator), send exactly the same requests as before. Instructions you write yourself, such as game rules that name you, are still sent as written.


## Share documents and images

Use **＋ Attach** beside the composer, drop files onto the composer area, or paste an image. Each message accepts up to four files of 10 MB each, with an optional caption. Both comparison panes have independent attachment drafts. **Send** saves the message locally; **Continue** sends the effective conversation, including its files, to the selected model.

Supported images are PNG, JPEG and WebP. Supported documents are PDF, Word `.docx`, and UTF-8 TXT, Markdown, CSV, TSV, JSON and log files. The original file is downloadable from its message. **Read extracted text** shows exactly what Room extracted from a document. PDF and Word extraction is text-only: document images, charts and layout are not sent. Scanned PDFs without selectable text need OCR elsewhere, or their pages can be attached as images. Documents above 100,000 extracted characters are rejected rather than truncated.

Images are sent as inline image inputs using chat-completions `image_url` content parts, alongside the conversation and attachment labels. The chosen provider/model must accept image input; Room never silently drops an image and retries with only text. Compatibility failures remain inspectable provider errors. Together's [image input format](https://docs.together.ai/docs/inference/vision/overview) was checked for this implementation; live image calls were not made during development. OpenGateway receives the same compatible request format; image support depends on the chosen route/model.

Each request includes every attachment still present in effective history, with a maximum of 12 images / 20 MB of image input and 200,000 document characters per turn. Exceeding those limits produces an explicit error before any provider or shadow request. Use a branch with fewer attached messages to reduce input. Jev receives extracted document text and image filenames marked as unavailable visually; it does not receive image pixels.

Attachments are immutable records in `.room-data/attachments/`: original bytes, SHA-256 hash, filename, media type and saved extraction. Messages reference their IDs, so files survive restarts, forks, comparisons, retcons and message restoration. Removing an attachment draft or deleting its message does not erase original evidence. Research JSON exports include referenced original files and exact requests. Inspect lists which files were sent and whether they entered as extracted text or image input; large image payloads are summarized on screen, with **Download exact request with image data** preserving the full request.

No npm dependencies were added. PDF extraction uses installed `pdftotext` (standard Homebrew/Linux paths, or `ROOM_PDFTOTEXT`); Word extraction uses macOS `/usr/bin/textutil`. File pickers advertise those formats only when their local extractor is available. Extraction has a 15-second timeout and an output limit. Unsupported, empty, unreadable or oversized files show errors before they enter a message.

## Revise a reply

**Revise** under a generated reply opens a review in the side panel. Write feedback ("Don't invent having seen calendars. Keep the point grounded.") and click **Generate alternative**. That makes one request with the same provider and model: the reply's original request, unchanged, plus a final instruction containing the original reply and your feedback. Nothing in the conversation changes yet.

Each candidate can be edited, then **Accept**ed or **Reject**ed, with an optional note. Judgments are append-only; the latest one counts. An accepted candidate offers two separate actions:

- **Replace in conversation** swaps the reply in place, as a new revision (`replace-message`). The original stays in earlier revisions and in the review. Later messages that responded to the original are left as they are; the panel says how many there are. Your feedback never enters later turns.
- **Training**: approve the pair as a training example (original input → accepted reply), and optionally keep the original as the rejected side of a preference pair. Approval follows the accepted text; a later rejection withdraws it.

Export approved examples from the review panel as JSONL: `/api/dataset/sft` (chat messages ending in the accepted reply) and `/api/dataset/preference` (input with `chosen` and `rejected`). Both use the original input without your feedback, so the lesson is to answer well without needing the correction. Nothing trains a model. Records: `reply-reviews`, `reply-candidates`, `reply-candidate-results`, `reply-judgments`, `training-decisions`. Revisions are not speaker selections and are not written to `selections`. A candidate interrupted by a restart is marked `interrupted` and never retried.


Rooms created before the vault release default to empty harness instructions, with only `{transcript}` in the conversation header; such a room needs a first message or an explicit opening instruction before generation. Existing rooms retain their saved framing (including legacy implicit framing); Reset to default selects the transcript-only framing. New v2 rooms start differently (see **People and the vault**). Character prompts and shared room instructions remain separate settings.

Comparison snapshots keep the source title without accumulating “compare copy” suffixes. Existing automatic copy/retcon suffixes are hidden in conversation headings, without rewriting saved research records. Retcons and full history edits keep the same conversation and comparison pane IDs; previous content remains in Inspect → State history.

## Readable PDF export

Export now offers **PDF · transcript & prompts** alongside the existing research JSON download. The PDF option opens a standalone print view; click **Save as PDF / Print** and choose Save as PDF in the browser's print dialog. Disable browser headers and footers for a clean document. This uses the browser's PDF engine and needs no new runtime dependency.

The layout uses a restrained green accent, serif body text, numbered speaker headings and A4 print margins. The transcript comes first; current shared instructions, active characters' personality prompts and retained memories, and harness templates follow on a new page. These are current settings, not a reconstruction of historical requests. Research notes, raw API responses, and file contents are excluded (attachment counts remain visible). Exact historical evidence stays available in JSON. Long messages can flow across pages; speaker headings stay with the following text.

The Compare conversation picker includes a live name search across conversation titles and branch names. Search terms are case-insensitive and can match different parts of the title; a result count and empty state make filtering explicit. The selected result stays selected while it still matches.

## People and the vault

Rooms hold **people**: instances with a label ("the judge", "movie star #1"), a personality prompt, an optional **situation**, memory and provider settings. The **vault** holds reusable material with no names. Nothing in the vault, and no people action, makes a model call.

**Vault** (sidebar → Vault). Three kinds of item, each with mutable metadata (working title, archived) and immutable revisions:

- **Components**: one portable piece of a person, as free text. A component can have a kind and tags (archetype, trait, voice/form, belief, want, habit, tension/contradiction, example lines). Kinds are data: **Manage kinds** renames, describes, archives or adds them, and a rename keeps the kind's identity. Kinds and tags are for browsing only; they never change how anything compiles. Example lines are plain text, not chat messages.
- **Personas**: an ordered list of component revisions plus extra text. Compiler v1 trims each part, skips blank ones, and joins them with one blank line. No headers, kind labels or names are added. The server computes the compiled text (a client-sent `compiled` that doesn't match is rejected). A persona can reference archived components and can have none.
- **Room templates**: room instructions, optional framing, flow (random or back-and-forth), an optional opening (spoken by you or a narrator), and a cast of persona revisions with labels and situations.

Each item page shows its revision history with a diff against the previous revision. Revising a component changes nothing downstream: a persona referencing it shows "newer revision available · use it" on that row, and saving the persona is the adoption. Working titles never reach a model. A fresh data directory starts with an empty vault. The starter kinds are seeded at startup as editable records with fixed IDs; a completion marker (`vault-meta/starter-kinds`) is written last, so an interrupted startup completes the set next time without duplicates. Archive and restore use a metadata version that changes on every metadata edit, so a stale page can't undo someone else's archive. Records: `vault-items`, `vault-revisions`, `vault-kinds`, `vault-kind-revisions`.

Placement follows scope: a portable want goes in a component; a want for one evening or one relationship goes in the person's situation.

**New rooms** are always v2 (see below), either empty or from a template. A template room copies the template's instructions, framing, flow, opening and cast once, and records the template as its origin. The opening is inserted once, at creation, as a `template` message attributed to you or the narrator.

**Characters panel.** People are listed by label with badges: *from <persona>*, *diverged* (the prompt was edited here and no longer matches its persona revision), *update available* (the persona's latest revision compiles to different text), *inactive*, and *review situation* (a situation still mentions someone's former label). Actions:

- **Add person**: label, persona (or blank), situation, provider, model, temperature and reasoning. A preview shows the assembled system message before anything is saved. Two people from one persona are independent.
- **Rename**: changes the label from now on. Earlier lines keep the label they were written under (the transcript sent to models too), and a "now …" note appears beside them. Situations that name the old label are flagged, never rewritten.
- **Adopt…**: shows a line diff of the prompt and the origin change, on this branch only. Label, situation, memory and provider settings never change. If the prompt was edited here, the only choices are Replace or Cancel; there is no merge.
- **Deactivate / Activate**: a deactivated person leaves the room but stays in its cast, so history, label and attribution survive. People are never deleted.
- **Assembled**: the exact system message the next request would send.

Labels are 1–80 characters on one line, without `:` (transcripts use `Label: text`). Spaces, digits, `#` and Unicode are fine. Labels must be unique within a room and may not equal your name. The comparison is exactly NFC normalization followed by JavaScript `toLowerCase()`; this is not full Unicode case folding (for example, `ß` and `ss` count as different). The Characters settings save is a field-level merge: it only sends the shown person's fields and the shared settings.

**Template adoption** (Characters → Room template → Adopt from template…) offers room instructions, framing and flow separately, each with a diff. A field changed in this room needs "Replace values that were changed here". Provenance is tracked per field, so adopting only the framing doesn't mark the instructions as up to date. The cast and opening are never re-applied; add and remove people by hand.

**Flow.** Back-and-forth (Characters → Flow) needs exactly two active people. When the cast changes so that's no longer true, the flow resets to random and the revision reason says so.

## Assembly versions and the validation policy

Existing rooms are **legacy-v1**: their requests are byte-identical to before (checked against golden fixtures in `tests/fixtures/legacy-requests.json`), and replies are checked against **all 8 legacy names**, including inactive ones, and not your name. New rooms are **v2**:

- System message: persona prompt → situation → room instructions → retained memory → identity line, with empty parts dropped. A v2 room without saved framing uses the default framing text.
- New rooms start with **empty room instructions** and the **default framing**: an identity line, the conversation header, "The conversation has not started yet." for an empty transcript, and the turn instructions with the participant list. So an empty room can generate its first turn as soon as it has a person, and Inspect shows exactly what was sent. Empty room instructions are not a neutral context: the framing, the persona and the model's own defaults still shape every reply. Existing rooms keep their instructions and framing.
- Replies are checked against the room's **full cast (active and inactive) plus your name**. A reply that starts with another person's label (any label format) is rejected and retried, as before.

This difference is intentional. A legacy room switches to v2 only when you add a person or rename someone, after a preview listing the consequences, and the switch is recorded in the same revision. Earlier revisions, and any replay of them, keep legacy behavior. Every attempt records `personId`, `labelAtDispatch`, `validationRoster`, `assemblyVersion` and, for people from a persona, `origin` (persona item and revision). Inspect shows these as **Identity at dispatch**, with a link to the persona revision that ran. **Revise** always speaks as the original attempt did; attempts recorded before this change use the persona name as ID and label and the 8 legacy names.

**Attribution.** Messages in v2 rooms carry `speakerRef` (a person, you, the narrator, or unbound). Legacy messages are read through their own state's names: your messages are you, generated lines are their character, and anything ambiguous (for example a retconned line under a name that is both yours and a character's) or unknown (imported speakers) stays **unbound** and is shown that way. Narrator lines never put you in the roster. **Edit history** has a "who said this" selector per row: text-only edits keep attribution, and typing a different label without choosing a person makes the line unbound rather than reassigning it. Jev sees labels, never person IDs.

Retcons choose the target state first (historical for regenerate, current for keep), which decides who exists and participates; memory then comes from the chosen source for each person who exists in both. Experiments can patch `characters.<person id>.label` and `.situation` (origin is not patchable); a label patch on a legacy room also needs `"assemblyVersion": "v2"`. Patching a person's prompt marks them diverged in the design diff. The measured speaker can be any person.

## Runs

Every Continue creates a run record (`runs/`) before its first request: branch, policy (random, back-and-forth or a fixed person), turn limit (at most 20), status transitions, turn IDs and usage. The browser then asks for turn 1, 2, … in order. The server accepts only the next index; asking for an index again returns the existing turn and never sends another request. Only one run can advance per branch, so a second tab is refused while one is running, and while a turn is pending any other index is refused. A tab showing a run it didn't start follows it through live updates (or, while disconnected, polls it until it ends), and refreshes when the window regains focus or the network reconnects.

You can **Send** during a run. Your message is recorded on the run (a `human-message` transition) and becomes the run's expected head, so the run continues. If a reply was being generated at that moment, it was produced against the conversation without your message: it is kept as detached evidence, never attached, doesn't count toward the turn limit, and the next turn is generated after your message.

A run ends as **completed** after its last attached turn, **stopped** when you press Stop (nothing further is sent, and a response arriving later is stored as canceled), **failed** when a turn fails, or **interrupted** when the conversation changes outside the run in any other way (settings, history edits, adoption, deletion), when no next turn arrives within 60 seconds of the previous one (`ROOM_RUN_TIMEOUT_MS`; the browser is assumed gone), or when the server restarts. Runs are never resumed. Usage counts retries; attempts whose provider reported no usage are counted as missing, not as zero. The turn bar shows the active run and its usage, including a run started in another tab, which Stop can also end.

## Live updates

The page keeps a connection to `GET /api/events` (Server-Sent Events, loopback only) and shows **● Live** at the bottom of the sidebar, or **○ Reconnecting…** while it is down. Every record the store writes produces a notice `{kind, id, branch?, experiment?, at}`: IDs only, never text, prompts, reasoning or other content. When a notice touches the open conversation, either comparison pane, or the open experiment (including its trial branches), that view refreshes within about 300 ms, so turns forced over the API, other tabs' runs and experiment trials appear as they land. New rooms, branches, Trash and experiment changes update the library. A refresh keeps your draft, the focused field and caret, open Inspect details and the scroll position (following the bottom if you were there); it waits while a dialog is open. The Vault page is never refreshed live.

While connected, the run and experiment polls are off; if the connection drops they resume, and the page reconnects with backoff (1 s, 2 s, … up to 30 s) and refreshes once on reconnect. A hidden tab closes its connection (browsers allow about six per host) and reconnects and refreshes when shown again. If a live refresh fails, it is retried (1 s, 2 s, … up to 15 s) against whatever view is open until one succeeds. The stream makes no provider calls and writes nothing; a read-only instance serves it with no notices.

## Backup and restore

```sh
npm run backup                         # stable data → ~/dev/room-backups/<timestamp>/
npm run backup -- --offline-confirmed  # only when you know the server is down and nothing is running
npm run backup:verify-restore -- ~/dev/room-backups/<timestamp>
```

`npm run backup` first asks the running server (port 4317) whether anything is active: turns, experiment batches, Revise generations or pending Jev observations. If so, it stops. Otherwise it pauses all changes on the server (`POST /api/admin/quiesce`; writes then return 503). An unreachable server counts as a failed preflight, not as proof that nothing is running. It then unloads the launchd job with `launchctl bootout` (never `kill`); if the job isn't loaded, it is left stopped and not started afterwards. It waits until no process holds the data directory, copies it with 700 permissions, writes `manifest.json` (path, size, sha256 per file) and `metadata.json` (time, source, app git revision, uncommitted-changes flag), verifies the copy, and reloads the job if it had been running. How long the service is down depends on the size of the data and hasn't been measured; plan for it. A copy that fails verification keeps an `INCOMPLETE` marker and is never reported as a success. Defaults: `ROOM_DATA_DIR=~/dev/room/.room-data`, `ROOM_BACKUP_DIR=~/dev/room-backups`, `ROOM_SERVICE_LABEL=com.deniz.room` (`none` skips service control, for scratch instances), and `ROOM_APP_DIR=~/dev/room-stable`, the app actually serving the data, whose git revision and path are recorded in the backup.

`backup:verify-restore` checks the backup against its manifest, restores it into a temporary directory, extracts the recorded app revision from the recorded app directory with `git archive` (a **matching-version restore**), starts it read-only on a free port, opens a sample of rooms, comparisons and experiments, stops it, and confirms the restored copy is byte-identical afterwards. **Read-only mode** (`ROOM_READONLY=1`) refuses every write, skips startup recovery and doesn't convert legacy comparisons. App revisions from before read-only mode existed are refused. `ROOM_VERIFY_APP_DIR=<newer checkout>` runs newer code against the copy instead; the result is labeled **compatibility with newer code**, not a matching-version restore. That is the only option for backups taken from a version without read-only mode.

## Perspective history (stage 1.5a)

In a v2 room, **Characters & settings → History** selects **Transcript** (the unchanged default) or **Perspective**. Save settings to create an immutable revision; the changes view records the History change. Legacy rooms keep their existing assembly and do not offer this control until an explicit v2 switch through Add person or Rename. Experiment conditions can switch to v2 and set `assembly: { history: 'perspective' }` together. An `assembly` patch replaces the entire configuration; unknown fields and values are rejected.

Perspective (`perspective-1`) keeps the v2 system message. It assigns the selected person's own messages to assistant turns by resolved **person ID**, and everyone else's messages to user turns with their stored written labels. This includes human, narrator and unbound lines; two people from one persona remain distinct. Consecutive turns with the same role merge with two newlines. A history starting with an own line receives the user padding `(The conversation so far.)`; the default roster and turn instruction finish the final user turn. Empty history uses the default opening. The quoted transcript wrapper is not sent in this mode. This changes role attribution, not visibility: everyone still sees the full history.

Perspective requires default framing (or an absent frame). **Reset to default** restores it in v2 rooms. Custom framing can remain saved, but preview and generation fail until it is reset or History returns to Transcript; changing History never silently resets framing. Documents stay inline and images appear at their message's position in saved attachment order. An image on the selected person's own message is unsupported and fails before both character generation and shadow Jev. Existing missing-file, document and image limits still apply. Empty own turns are rejected instead of being silently dropped or filled.

**Preview request** shows the complete ordered roles, text and named image positions using the dispatch assembler, including unsaved settings. It makes no provider call and saves no revision. A person's **Assembled** action previews the saved request. Attempts record the resolved history configuration, perspective adapter version and exact request body before dispatch. Protected retries append their correction to the saved final user turn; Revise appends its complete instruction, quoted earlier reply and feedback there too. Neither reads current prompts, labels or vault heads to reconstruct the request. Historical and transcript Revise retain their existing separate user instruction. Forks and restarts preserve the saved configuration; regenerate retcons restore the historical configuration, while keep retcons retain the current one.

The same contract applies to OpenGateway, Together and local demo. Provider rejection is recorded without falling back to transcript. Shadow Jev's payload and stored character-prompt criteria are unchanged. PSRI's reported style-echo reduction came from other models and experimental setups: any benefit in Room is a hypothesis to compare, not an established result for these providers or rooms. No provider calls were used to implement or test this option.

Golden compatibility fixtures cover stage 1 legacy/v2 bodies, first attempts and protected retries, absent/default/custom/fully blank framing, and mixed document/image input. Perspective fixtures cover identity, merging, padding and attachment order; acceptance tests also exercise saved-input Revise, concurrent experiment conditions, Jev parity, zero-call preflight and preview, preservation and failed providers.

## Places (stage 1.6)

People in one room can be in different places. Each person's model receives only the **messages** they were present for. Hiding works only by leaving lines out of a request; nothing instructs a model to ignore anything. The scope is message history: room instructions, prompts, situations and memory are sent as before, and you can write anything into them.

**Turning places on.** In Characters, **Places → Add places…** names the places and puts everyone in one, including inactive people and you. A preview comes first. A legacy room is switched to v2 in the same revision, also after a preview. Earlier messages stay public, and no movement line is written. In this release places can't be removed, and places can't be turned off again. A room template can declare `places`, a `place` per cast entry and a `humanPlace`. Anyone left unassigned starts in the first place. A human opening is heard where you start; a narrator opening is public. A template without places creates a room without them. Adopting a later template revision never changes placement.

**Who hears a line** is fixed when the line is stamped, by ID. The stamp also stores display names, so tags keep the names that applied then:
- your message: the active characters in your place, plus you;
- a reply: the active characters in the speaker's place, plus you if you're placed there (whether or not you have spoken), taken from the state the request was dispatched from. A reply that returns after a move is detached as usual and is never re-stamped;
- **Narrate…**: one place (whoever is there now), or public;
- **Move people…**: one revision that changes placement and adds an editable narrator line. Everyone in the origin and the destination hears it, movers included. Movers must share one origin and be active (you can move too). A destination can be created in the same step. Moving into the current place is rejected. Moves and narration interrupt a running run.

Knowledge belongs to people, not places. Someone who leaves keeps what they heard. Someone arriving, rejoining or added later hears nothing said before they got there. Deactivated people aren't present and can't be selected. **Rejoining** and **Add person** both ask for a place. In a room with places, Save settings can't change who is active; use Activate/Deactivate, which asks where someone rejoins.

**Edits never widen who heard a line.** Text-only history edits, attribution changes, one-line retcons, Revise and Apply, delete and restore, branching and comparisons all keep the stored audience. **Who heard this** is the only way to change it. It is a previewed audience edit that lists who gains and who loses the line, and it can make a line public. It takes a fresh snapshot, and it can leave out the speaker. The API never reads a missing choice as public: an audience edit and a narration must send their audience or place, and only an explicit `null` means public. In the history editor, each inserted line needs an explicit place or public, and a person or human line must be in the chosen place. Keep retcons keep the current placement. Regenerate retcons restore the historical placement and keep any places created since. Regenerating from before places were turned on is refused, because it would turn them off.

**Assembly.** One projection, “visible to X”, runs before both history modes. It feeds the transcript (in every frame placeholder), perspective turns, documents, images, filenames, attachment limits, previews and counts. With nothing visible, the empty-conversation opening is used even if hidden lines exist. The roster in the turn instruction is local: the active people in the speaker's place, plus you if you're there and have spoken in the speaker's visible history. Reply validation still uses the full cast, so a reply labelled as someone in another room is rejected as a wrong-speaker reply. Each attempt records `visibility: { policy: 'audience-1', person, place, hidden, visibleMessageIds }` outside model context. Revise reuses that record. Shadow Jev sees the selected speaker's visible history (filtered first, then the last 20) and the active people in that place, and records `visibility`.

**Turns.** Continue has a **Place** control: one place, or **Rotate between places**. It defaults to the place you are viewing, then to your place. Only the active characters in that place can speak. The last-speaker rule looks at the latest line by a person that was stamped in that place; public, human and narrator lines don't count. Choosing a place with one character lets that character speak, even with random selection. A place with nobody can't generate. Back-and-forth needs exactly two characters in the run's place; in rooms with places the room flow isn't reset by the overall cast size, and the Flow setting offers back-and-forth when at least one place holds exactly two active characters. Rotation visits places in order that have two active characters, or one plus you. The run record stores the order and the cursor. The cursor advances, wrapping around, only after an attached turn, so a turn detached by your interjection retries the same place. Back-and-forth rotation needs exactly two characters in every place it visits, and a fixed speaker can't rotate. Moves and other placement changes interrupt the run, forks don't inherit it, and a restart marks it interrupted with its final cursor kept. A direct `/turn` call must name a concrete place. Selection records add `place`, `placePolicy` and, when rotating, `cursor`.

**Experiments.** A condition may replace `locations` as a whole. That is a placement intervention at the frozen checkpoint: there is no movement line, no audience is changed, and it grants no retroactive knowledge. It must keep every existing place with its name, but it can move people and add places. Each trial runs in the measured speaker's place after the patch, and it records that place and the visible message IDs. To study an actual move and its announcement, prepare the base branch with Move. **Scope restriction:** a condition can't add places to a checkpoint that has none; turn places on in the base branch first.

**Views and exports.** Scoped lines carry a tag (“the hall · Gav, Marta”), and moves carry a movement tag. The **View** control shows everything, one place (its lines, public lines, and moves into or out of it), or **as seen by** a person. “As seen by” is that person's next-request history projection at the current revision, computed by the server with the dispatch function (`GET /api/branches/:id/seen/:person?revision=`). It shows the history, not the prompts or framing. **Scope restriction:** the View control shows the current revision only; the view at an earlier revision is available through the API's `revision` parameter, not in the UI. The composer shows **Speaking in**. The changes view lists audience edits, moves, new places and renamed places. The printable transcript, the new Markdown transcript (`/transcript.md`) and the JSON export (`locationTags`) mark scoped lines `[the hall: Gav, Marta]` and moves `[move: Gav · the table → the hall]`.

Moving, narrating, turning places on, renaming places, audience edits, previews and views make no provider calls. Rooms without places send byte-identical requests in legacy, v2 transcript and v2 perspective modes.

## Room-loading performance

Ordinary browser refreshes request `?view=conversation`, which returns the current state and inline observations without the full attempt archive or historical state snapshots. Inspect loads full evidence on demand; exports and the default branch API retain it. Former character labels remain available in the lightweight view.

The store caches parsed JSON and directory listings. File metadata (including inode, modification time, change time and size) is checked before reusing a record; atomic writes by this or another process invalidate cached content. Returned records are cloned so edits cannot mutate the cache. Filtered record reads clone only matches, and attempt outcomes are joined only for matching attempts. Records and durability guarantees remain unchanged. First reads after restart still warm the cache; subsequent interactions avoid reparsing the archive.

## Improv direction (v1)

The **Improv** panel enables optional pre-turn direction for a room. Select a writer provider/model, edit **Jev decision instructions** and **Writer instructions / creative intentions**, then enable and save. Opening or editing the panel makes no model calls. Existing rooms start with this feature off. The writer model is independent of character models and can be changed at any time.

After speaker selection and input validation, an eligible turn asks Jev whether the selected character needs a persistent prompt addition. Jev sees the assembled system prompt, the character's full visible transcript, and the writer brief. It uses `jev-latest` and a `noul` probability; it is separate from the optional Jev shadow observer. Places are respected before either call: neither Jev nor the writer receives unheard scenes. The writer also receives visible image inputs when present; Jev sees only image availability/filename information. Provider/model vision support is still required.

Defaults are a probability threshold of 0.8, three completed room replies of cooldown after the directed reply for that character, and at most three active additions within the last ten completed room replies. Cooldown/rate-limited turns skip the Jev call and record why. Limits count effective history and retained additions, so retcons or removing additions affect these controls. Jev's editable default instructions favor no intervention when ordinary continuation is enough, and explicitly weigh the risk of over-scripted characters. There are no fixed semantic restrictions on inventions: the editable writer brief sets the creative direction.

The default writer is OpenGateway `deepseek/deepseek-flash` at temperature 0.8; Together and other model IDs are selectable. OpenGateway writer requests disable thinking for latency. Writer output is limited to 700 completion tokens and must contain a complete, nonempty addition of at most 2,000 characters; oversized or token-truncated output is rejected, not applied. The total Jev + writer deadline defaults to eight seconds and can be set from 500 to 30,000 ms. There are no improv retries. A failure, invalid response, or deadline falls back to the ordinary character generation. Stop aborts the pre-turn flow; late results cannot be applied. Character inference time is separate from this deadline.

An approved addition is committed as its own revision **before** dispatching the character reply. It remains even if that reply subsequently fails. Additions are stored separately from personality instructions and appended to the assembled system prompt. They persist through future turns and independent branch/comparison copies. Disabling Improv stops new direction but does not erase existing additions. Use the panel to edit or remove individual entries; prior revisions and original requests remain evidence. Current additions also appear in request previews, diffs and readable prompt exports.

Changes to the room during the pre-turn calls prevent the old result from being applied and detach that turn. Settings and addition edits use expected-head checks. Refresh additions & decisions reads saved evidence without calling models. Records distinguish declined, cooldown, rate-limit, timed-out, failed, canceled and prepared results, plus a separate applied/discarded record. Raw requests, responses and available usage are preserved in `improv-decisions`, `improv-requests`, `improv-outcomes`, `improv-results` and `improv-applications`; full research exports include them. Improv usage is separate from the character run's token totals. Interrupted calls are marked on restart, never retried automatically.

Validation uses mocked provider responses; the defaults are a starting hypothesis, not a measured creative-quality or latency guarantee. Tune the prompts, threshold, model and deadline against recorded decisions. Enabling improv for an experiment also adds this intervention process to its trials; leave it off when testing character inference alone.
