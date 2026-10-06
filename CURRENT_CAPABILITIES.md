# Room — Current capabilities specification

**Status:** Implemented behavior, not a roadmap  
**As of:** 2 October 2026  
**Code baseline:** `f14f9e8` — the current `main` and `stable` commits  
**Scope:** The local browser workbench. The retired Discord frontend is outside this specification.

This document describes what the application currently does, based on the implementation in `src/workbench/` and `web/`. It supersedes older descriptions of implemented behavior where they conflict. `PRODUCT_SPEC.md`, `JEV_SPEC.md`, and `EXPERIMENTS_SPEC.md` describe product intentions; they are not proof that a feature exists. Provider availability and model behavior are external dependencies, not guarantees made here.

## 1. Product purpose

Room is a local, single-user application for conversations among AI characters and a human, with tools for studying and shaping the behavior that emerges.

Its implemented loop is:

**Converse → inspect → branch or edit → compare or experiment → review alternatives → curate examples.**

Room can prepare training examples, but does not train models. Changes to personalities, memory and history change subsequent requests; they do not change model weights.

## 2. Core objects and boundaries

| Object | Meaning |
| --- | --- |
| Conversation | A named room with participants, settings and effective message history. |
| Branch | An independent continuation of a recorded state. It has its own current revision. |
| Revision | A saved snapshot of history, prompts, memories and settings. Editing creates a new revision. |
| Generation attempt | The request recorded before dispatch, linked to a separate outcome containing the provider response and processing. |
| Comparison | Two independently editable conversation copies, with a saved pairing and optional child comparisons. |
| Experiment | A question, prediction, checkpoint, measured speaker, conditions and optional outcome extraction rule. |
| Trial | One measured generated turn from an experiment condition's starting state. |
| Reply review | An original reply and request, feedback, generated candidates, judgments and optional training decisions. |

**Effective context** is what a character receives: its instructions, shared instructions, retained memory, selected framing, effective history and supported attachments.

**Research records** describe what happened: attempts, earlier revisions, observations, Jev results, reactions, experiment labels and review decisions. These are not automatically inserted into ordinary character requests. Feedback is explicitly included in the request to generate a revision candidate; it does not become conversation context merely because it was recorded.

## 3. Conversations and characters

### Available controls

- Create a named conversation and send human messages.
- Choose which of the eight built-in characters participate: Boris, Ilya, Alexandra, Elorin, Jonas, Ceryn, Velric and Rook.
- Edit each character's personality prompt, retained memory, provider, model identifier, temperature and reasoning setting.
- Edit shared room instructions, the human display name, identity-check policy and harness framing.
- Apply provider, model, temperature and reasoning settings to the whole cast while preserving individual prompts and memories.
- Generate one reply or a run of up to 20 turns. Sending a human message does not itself generate a reply.
- Stop an active run. Local cancellation cannot guarantee that the provider stops processing or charging.

The character roster is defined in code. Editing existing characters is supported; creating arbitrary new character identities is not exposed in the UI.

### Speaker selection

The operator can choose a specific character or select randomly. Random selection avoids the most recent character speaker when another eligible participant exists. A fixed voice repeated within a run is recorded as an initial `forced` choice followed by `locked` turns.

With exactly two participants, **Back-and-forth** alternates between them. Human messages do not advance that alternation. Selection records include the method, eligible characters, selected character and run information. Jev does not select the speaker.

### Providers and defaults

The application supports OpenGateway and Together chat-completions inference. Model IDs are entered directly; there is no model catalog or automatic capability negotiation. New rooms currently default to OpenGateway with `deepseek/deepseek-flash`.

A local placeholder provider is available only when the server starts with `ROOM_DEMO=1`. It is for testing and does not run an AI model.

Reasoning settings are **Provider default** and **Off**. The implementation supports OpenGateway's `thinking: {type: "disabled"}` switch. Together's Off setting is rejected because the app does not have a verified equivalent. Provider-returned reasoning is displayed when available; absence of returned reasoning is not evidence that no internal reasoning occurred.

## 4. Prompt assembly and memory

A character's system message combines its personality prompt, shared room instructions, retained memory and any identity framing. Blank components in custom framing are omitted; if the resulting system content is empty, no system message is sent.

The transcript formats messages as `Speaker: text`. It is quoted into a single API user message, rather than mapping each character to a separate API role. The human badge shown in the UI is not included in this text. The API user role therefore does not identify which transcript participant is human.

Harness framing has four editable templates:

| Template | Purpose |
| --- | --- |
| Identity | Additional instructions at the end of the system message. |
| Conversation | Wraps the existing conversation. |
| Opening | Used when the transcript is empty. |
| Turn | Additional instructions at the end of the user message. |

Supported placeholders are `{speaker}`, `{participants}` and `{transcript}`, with single braces. Substitution is performed once; placeholder-like text inside the conversation is not expanded again.

**New rooms default to blank harness instructions with `{transcript}` as the conversation template.** Existing rooms preserve their custom framing or legacy implicit framing. Reset to default selects the new minimal framing. Character and shared instructions remain separate and are not cleared by this default.

An empty room needs a first message or opening instructions before generation. A custom conversation template that omits `{transcript}` can leave saved messages out of model input. Empty assembled user content produces an explicit error before generation or Jev observation.

Memory is manually edited. Model-generated future-self notes are retained in attempt evidence but are not automatically applied. There is no automatic memory consolidation, separate private history per character, or formal personality-evolution mechanism. Characters can respond differently as context changes, and the operator can study this through revisions and experiments.

## 5. Reply processing and evidence

Every dispatched generation request is recorded before the provider call. Its outcome preserves the raw response, processed text, transformations, validation, available usage, finish reason, timing and errors. Authorization headers are not saved with the request.

Processing can remove future-self notes and an assigned speaker label. Replies are capped at 2,000 characters after generation, even when the harness does not request that limit. Raw output survives truncation.

Identity checks have two modes:

- **Protect:** reject recognized labels belonging to another character and make one corrective retry. The rejected attempt remains recorded.
- **Observe:** retain the reply and flag a detected wrong label without that retry.

These checks inspect explicit speaker labels. They do not reliably detect a reply that adopts another character's perspective without naming that character.

Inspect shows requests, responses, transformations, selection evidence, Jev records and state history. Returned reasoning is shown as provider evidence. Large image bytes are summarized in the inspector; an exact-request download retains them.

Edits use expected revision IDs to reject stale writes. A generation arriving after its branch changed is retained as detached evidence and is not added to the changed conversation. Interrupted work is recovered as recorded status on restart, without automatic spending to resume it.

## 6. Branches, retcons and message deletion

**Branch** copies the current state. **Branch here** uses the earliest recorded checkpoint containing the selected message, including the available settings and memory at that point. A branch develops independently from its source.

**Retcon edits the current branch.** It does not create a separate branch. The operator may keep later messages or remove them and prepare a new continuation. Removing later messages restores historical settings; memory can separately be restored to the checkpoint or kept from the current state. Generating a new continuation requires an explicit Continue action.

**Edit history** can insert, edit, remove and reorder messages in the current branch, with a choice to keep or clear retained memories. Prior revisions remain available. To preserve two active alternatives, branch before editing.

**Delete message** removes one message from effective history while keeping later messages and memory. Inspect exposes a restore action for these deletions. Earlier requests remain unchanged. Retconned or retained replies may therefore have generation records describing an earlier context; those records are not reconstructed to match the edited history.

Conversation families have a branch picker and left/right navigation. Main conversation lists contain originals, with branches accessible through the family. Automatic comparison-copy suffixes no longer accumulate; legacy copy/retcon suffixes are hidden in conversation headings without rewriting historical records.

## 7. Independent comparisons

Compare opens independent snapshots of two selected conversations. The picker supports live, case-insensitive search over room and branch names, including multiple search terms, a result count and an empty state.

Each pane supports its own composer, generation, Stop, speaker selection, settings, branching, history edits, inspection and observations. Both panes can generate concurrently. Source conversations and comparison copies do not receive one another's later messages or edits.

Save comparison records a named pairing in the Comparisons category. Changing the branch shown in a pane marks that pairing unsaved. Branch comparison copies both current panes into a child comparison. Families can be navigated through arrows and a picker.

Comparisons are editable working objects, not permanently frozen screenshots. Their independence comes from owning their conversation copies. A settings/history diff is available between panes and between a branch and its fork state. Comparison does not automatically judge which conversation is better.

## 8. Jev shadow observations

Jev is optional and requires `TYPESAFE_API_KEY`. When enabled, ordinary conversation turns start an independent observation of the pre-reply context. Jev receives shared room instructions, active participants, character criteria derived from their prompts, and the last 20 messages. Document text and image filenames are included; image pixels are not.

It is asked who should speak next and whether responding would benefit from external factual research. Recorded output includes available speaker probabilities, a separate reported confidence score, research probability, usage, timing, raw results and failures. Requests include an instruction hash.

Jev never selects a speaker, performs research, adds instructions to character context or blocks the character reply. Its observation describes the situation before the reply, not the quality of the reply afterward. Reported confidence is not an independently validated measure of calibration.

**Show Jev observations** displays saved results below messages in either pane. This display toggle is separate from enabling new observations. Reading or refreshing records makes no model calls.

## 9. Controlled experiments

The Experiments interface supports a recorded question and prediction, a base conversation checkpoint, a measured speaker, one to six conditions with exactly one control, and an optional regex outcome rule.

Conditions patch settings: shared instructions, participants, human name, observation and identity policies, harness framing, or individual character prompt, memory, provider, model, temperature and reasoning. They do not directly patch transcript messages. To test a different history, prepare that history as a checkpoint and use it as the base of an experiment.

The design locks when trials are run or qualifying existing trials are attached. Later observations remain editable through appended notebook entries; changing the design requires a new experiment or a branch. Branched experiments copy the design but begin with blank question and prediction fields.

### Trial execution

- Run 1–50 trials per condition in a batch.
- Each trial starts independently from the frozen checkpoint plus its condition patch and generates one turn by the measured speaker.
- Conditions can execute concurrently; trials within a condition run sequentially.
- An isolated workspace holds each experiment's trial branches. They do not clutter the normal conversation list.
- Intended trials are persisted before dispatch. Timeout failures can retry twice; protected identity checking can also add corrective attempts.
- Stop cancels remaining work and aborts active turns locally. Restart does not resume spending automatically.
- Additional batches extend the recorded trial sequence.

Existing recorded trials can be attached retrospectively only after validation against the checkpoint and condition. Such attachment makes no model call and is identified as retrospective.

### Results and lineage

Results expose the measured reply, extracted outcome, manual labels and tags, latency, total attempt tokens, completion tokens, returned reasoning length and reasoning-token counts when supplied. The table supports sorting and condition, tag and completion-token filters. Condition summaries include outcome counts and completion-token median/range.

Regex extraction takes the first capture group from the last matching occurrence. Manual labels retain the extracted evidence and add a separate judgment. A later edit to a trial conversation does not replace its measured result.

Experiments can be branched or linked into families. Cycle-forming links are rejected. Lineage compares effective designs and displays per-experiment results without pooling counts. Statistical significance testing, blind evaluation and automatic semantic judging are not implemented.

## 10. Reply revision and training-example curation

Revise is available for generated replies with matching original request evidence. Imported or manually retconned replies cannot reconstruct that missing evidence.

1. Record feedback on the original reply.
2. Generate a candidate from the original request plus a separate correction instruction, using the original provider/model settings.
3. Edit the candidate if desired, then accept or reject it and optionally record a note.
4. Separately choose whether to replace the conversation reply and whether to approve a training example.

Generation alone neither changes the conversation nor approves training. Replacement creates a new revision and preserves the original reply. Later messages and retained memory stay as they were; they are not automatically regenerated to accommodate the replacement.

Training approval pairs the original input with the accepted text. If the original turn required an identity retry, the input follows the retry ancestry back to the initial request. Correction feedback is excluded from the training input. A preference pair additionally uses the original reply as rejected, but only after explicit preference approval. Identical replies cannot form a preference pair.

Judgments and training decisions are appended to the research record. Approval is tied to the accepted judgment; subsequent edits or rejection invalidate that approval until explicitly renewed. One current training decision is selected per original review. SFT and preference JSONL exports contain only currently approved examples.

This is basic example curation. There are no training jobs, dataset splits/version releases, deduplication workflows, fine-tune deployment controls or automated post-training evaluations. JSONL export does not guarantee acceptance by a particular training provider or model.

## 11. Documents and images

Files can be attached through the picker, drag-and-drop or image paste. Each message accepts up to four files of 10 MB each, with an optional text caption. Comparison panes maintain independent attachment drafts.

| Input | Handling |
| --- | --- |
| PNG, JPEG, WebP | Original image sent as an image content part to the chosen model. |
| PDF | Selectable text extracted using a locally available `pdftotext`. |
| Word `.docx` | Text extracted through macOS `textutil`. |
| UTF-8 TXT, Markdown, CSV, TSV, JSON, log | Text included as quoted document material. |

Original files remain downloadable, and extracted document text can be inspected. Extraction does not preserve document layout or send embedded charts/images. There is no OCR. Formats requiring unavailable extractors are not offered by the picker.

Limits are 100,000 extracted characters per document; per request, 200,000 document characters, 12 images and 20 MB of image input. Exceeding limits errors rather than silently truncating. Attachments still present in effective history continue to enter subsequent requests. The provider/model must support vision; Room does not silently drop incompatible images.

Original bytes, metadata, hashes and extraction results are retained locally. Branching, retconning and comparison copies preserve attachment references.

## 12. Organization, annotations and exports

The sidebar separates conversations, comparisons, experiments, Trash, Favorites and Dislikes. Family navigation keeps derived work accessible without listing every branch at the top level. Back navigation returns to previously visited conversations, comparisons or experiments.

Notebook entries can be associated with a conversation revision or message; experiments also have notebooks. Favorites and Dislikes are recorded per message, with append-only mark history. A mark follows a message into branches that preserve its identity. These annotations do not automatically qualify a reply for training.

Deleting a conversation or branch moves its subtree to Trash; restore recovers it. A separately trashed child must be restored separately after its parent. Independent comparison copies survive deletion of their source. There is no permanent-delete UI or automatic backup service.

| Export | Contents and access |
| --- | --- |
| Research JSON | Conversation state/history and linked research evidence, including requests, outcomes and original attachments; Export on a standalone conversation. |
| Readable PDF | Export opens a printable transcript followed by current shared instructions, active characters' prompts/memory and harness templates. Save as PDF through the browser print dialog. |
| Notebook Markdown | Conversation observations through the Notebook panel. |
| Favorites/Dislikes JSON | Marked replies, mark history and generation attempts. |
| Training JSONL | Approved SFT examples or explicit preference pairs, through the review panel. |
| Exact request JSON | A stored request, including original image payloads. |

PDF output uses current prompt settings, not the settings of every historical turn. It omits research notes, raw API responses and file contents, retaining attachment counts. It is a browser print workflow, not a direct server-generated PDF download. There is no dedicated combined two-pane comparison PDF export.

## 13. Runtime, persistence and verification

Room runs locally with Node 22, TypeScript through `tsx`, an Express backend and a vanilla browser frontend. `npm run workbench` starts the app. The default address is `http://127.0.0.1:4317`; `ROOM_PORT` and `ROOM_DATA_DIR` select another port and data directory.

Credentials are read server-side from environment configuration. The server binds to loopback and rejects foreign Host/Origin headers. This is not a hosted collaboration service: there are no user accounts, permissions, remote-sharing links or multi-user synchronization.

Records are atomically written JSON files under `.room-data/`, with immutable evidence records and mutable pointers to current state. One server process should use a data directory at a time. The directory is excluded from Git; committing source code does not back up conversations or research data.

The current installation separates development (`~/dev/room`, main) from the stable worktree (`~/dev/room-stable`, stable). Stable runs through launchd using the main folder's real data directory. Development changes reach stable only after an explicit update; test instances use disposable data.

Verification evidence at this baseline includes 49 passing workbench tests at the preceding PDF-export change, TypeScript checking, and a syntax check for the subsequent comparison-search change. Tests use mocked providers and temporary stores. This specification is a code audit, not a fresh end-to-end certification of live providers, browser rendering or every workflow.

## 14. Explicitly outside current capability

- Running fine-tuning jobs, deploying trained models, or updating weights from feedback.
- Autonomous web research, tool use, or agent actions outside the conversation.
- Jev-controlled speaker selection or calibrated decision policies.
- Automatic long-term memory generation, summarization or personality evolution.
- Separate private conversations or visibility rules for individual characters.
- Blind comparison studies, automated semantic grading or inferential statistics.
- OCR, audio/video ingestion, arbitrary document formats or guaranteed vision support across routes.
- Public hosting, multi-user access, account management or cloud synchronization.
- Permanent record deletion, automatic backups or a general research-JSON restore/import workflow.

The supported import path is for legacy Discord save structures. It preserves the source and marks absent historical evidence as unknown; it does not recreate original prompts or exact requests that were never saved.

## 15. Implementation reference

| Area | Primary source |
| --- | --- |
| Conversations, revisions, selection, retcons, Trash | `src/workbench/engine.ts` |
| Requests, provider dispatch, reply processing | `src/workbench/generation.ts` |
| Template expansion and identity label checks | `src/speakerTurn.ts` |
| Comparison isolation | `src/workbench/comparisons.ts` |
| Experiment design, execution, labels, lineage | `src/workbench/experiments.ts` |
| Jev observation inputs and records | `src/workbench/jev.ts` |
| Revision candidates and training decisions | `src/workbench/alternatives.ts` |
| Attachments and extraction | `src/workbench/attachments.ts` |
| Export document | `src/workbench/transcriptExport.ts`, `web/transcript.css` |
| API and local access boundaries | `src/workbench/server.ts` |
| UI workflows | `web/app.js`, `web/experiments.js`, `web/review.js` |
| Durable storage | `src/workbench/store.ts` |
| Regression coverage | `tests/workbench.test.ts` |
