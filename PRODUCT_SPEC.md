# Room — Product specification

Status: Draft for review · Version 0.1 · 22 September 2026

This document describes the proposed product, not features already implemented. Product direction reflects our discussion; architecture, release boundaries, and defaults below are proposals. Provider capabilities, supported models, and costs must be verified during integration.

## 1. Purpose

Room is a local application for conversations between AI characters and a human, combined with tools for investigating and shaping model behavior.

Its purpose is to make rich conversations possible and turn what happens in them into inspectable evidence, experiments, and eventually training data. Surprising behavior is valuable research material, including behavior that also needs a product fix.

The central loop is:

**Create characters → converse → notice something → inspect → branch and test → curate examples → train → evaluate → return to the room.**

Two goals reinforce each other:

1. Develop distinctive characters with interesting voices, perspectives, relationships, and potential for change.
2. Develop models that can maintain an assigned perspective under conversational pressure, across characters and contexts.

Neither rigid personalities nor automatic agreement with the operator defines success. The product should support disagreement, persuasion, uncertainty, and development while making identity confusion observable.

## 2. User and delivery format

The initial user is Deniz, working locally with an AI coding/research assistant. The initial product is a single-user web application running on the user's computer, accessed through a browser.

- Conversations, experiment records, and configuration are stored locally.
- Inference and training may use external providers; local storage does not imply local model execution. The UI identifies which provider receives a request.
- Together is the preferred planned training/inference integration. Keep provider routing replaceable so existing room models remain usable where practical.
- API credentials stay on the backend and are excluded from exported research records.
- Discord remains an optional interface to the shared conversation engine. Browser use must not require Discord.
- A desktop wrapper, multi-user service, and public hosting are outside the initial scope.

## 3. Core experience

The main workspace consists of a conversation, a character/participant panel, and an inspector that opens when needed. Research controls should be available without making ordinary conversation feel like filling out a form.

Users can create a room, choose characters, set the shared situation, write a message, request a specific character's response, or let the room select the next speaker. They can pause, continue, and run a bounded number of turns. Automated continuation has a visible stop control and turn limit.

Messages show their speaker and whether they were generated, manually authored, or edited. Research metadata is available through inspection rather than inserted into character dialogue.

## 4. Functional requirements

### 4.1 Room and turn control

- Choose active participants, including a single participant.
- Select the next speaker manually or use automatic selection. Log the selection method and any available selection output.
- Edit the shared situation and instructions.
- Stop future turns immediately; handle a request already in flight explicitly. A late response must never silently append to a different branch or revision.
- Display pending, completed, failed, canceled, and rejected attempts distinctly.
- Preserve the existing 2,000-character reply cap as the initial default. Store the complete provider response before any truncation; record the transformation separately.
- Keep inactive characters' prior contributions in history unless the user edits that history.
- Save and resume without losing branch state, character versions, or research annotations.

### 4.2 Character workshop

Each character has a stable identity, display name, versioned personality instructions, model assignment, generation settings, and optional memory.

The editor supports freeform characterization. Optional fields may help articulate values, habits, tensions, relationships, and boundaries, but must not force every character into the same template.

Users can preview the effective instructions and test a revision in a branch before adopting it elsewhere. Editing a character does not retroactively replace the prompt used by earlier turns or silently update other branches.

Distinguish three sources of behavior:

- **Instructions:** explicit personality and task descriptions.
- **Experience:** visible history, retained memory, and supplied context.
- **Model version:** the base model or trained version generating the reply.

### 4.3 Turn inspector and evidence capture

Every generation attempt has a durable record containing:

- Branch and state revision; selected character and active roster.
- Exact model-facing messages, including system instructions, history formatting, memory, and any injected research material.
- Provider, requested model/version identifier, generation parameters, and timestamps.
- Raw response as returned by the provider, errors, and usage/latency when available.
- Validation outcomes, retries, and the displayed response after transformations.
- Tool calls, arguments, results, and context selection or truncation decisions when applicable.

Rejected replies must survive even if they never appear in the conversation. The inspector separates what was sent, what was returned, and what was displayed. It must not present a retrospective explanation as the model's internal reasoning.

Users can export an inspectable run record with secrets excluded. Replaying an exact recorded request is supported as an experiment; identical output is not promised.

### 4.4 Branching

Users can branch at a message boundary or from the current state. The new branch inherits the history and relevant state at that point: character versions, memories, participants, shared instructions, model assignments, settings, and turn-selection state.

- Branches have names, parent links, and a recorded fork point.
- Subsequent messages, memories, and edits are isolated between branches.
- Multiple branches can be compared side by side from their common ancestor.
- Creating an unchanged branch permits an alternative continuation under the same conditions.
- Changes to a shared character definition require explicit adoption into an existing branch.
- Historical state must be recoverable from revisions/checkpoints. Current memory must not be copied backward into a branch made at an earlier turn.

### 4.5 Retcons

Within a branch, users can edit, remove, reorder, or insert conversation messages; change system/personality instructions; and edit memory. The editor previews the resulting model input.

Retcons create recorded revisions. Original content remains available in the research record even when hidden from the character's effective history.

Two continuation modes are required:

| Mode | Behavior |
|---|---|
| Keep later messages | Preserve subsequent dialogue after an earlier edit. Mark those messages as generated under the previous state; do not imply they were generated from the revised history. |
| Regenerate from edit | Create a continuation from the revised point, excluding subsequent dialogue from the new effective history. Preserve the original continuation in its branch. |

Memory requires a separate explicit choice: restore memory at the edit point, keep later memory as a deliberate intervention, or manually revise it. If historical memory is unavailable, the UI must say so rather than invent it. Any later memory regeneration is a new logged operation.

Characters see the revised context without an edit notice by default. The operator can deliberately disclose the change. Research annotations and edit history must not leak into their prompts.

Later extension: character-specific histories and memories, allowing different participants to receive different accounts of the same event. These views must remain individually inspectable.

### 4.6 Research notebook

Users can attach observations to messages, attempts, branches, or comparisons. An observation supports a short description, evidence links, interpretation, alternative explanations, and an optional next experiment.

Record whether evidence is directly preserved, reconstructed, or user-reported. Separate observation from hypothesis and proposed generalization.

Initial categories include identity confusion, claim ownership, distinctiveness, relevance, persuasion, stylistic convergence, and personality evolution. Categories are editable; they are not automatic verdicts.

Support Markdown export for the existing prompt-engineering notebook. Do not automatically rewrite external notes in the first release.

### 4.7 Personality evolution

Track behavior over sequences of interactions, not just isolated replies. The interface should help investigate:

- Is personality stable or changing?
- Is a change consistent with the character's described core, or does it suggest a revision of that core?
- Does its direction depend on topic, interlocutor, agreement, conflict, or other context?
- Does it persist in a different situation?
- Is it adaptation, development, identity drift, or an initially hidden trait becoming visible?

These are competing interpretations, not labels the product should infer with certainty. Users may annotate a trajectory with evidence and counterexamples.

A comparison workflow starts from a shared checkpoint, introduces different experiences, and later gives each branch the same probe. It records whether the probe includes full history, only retained memory, or another explicit context policy. Repeated runs help distinguish context effects from sampling variation.

Personality change is initially an observation dimension, not a reward to maximize. Changing one's mind must not automatically count as identity loss; remaining unchanged must not automatically count as success.

### 4.8 Experiments and evaluation

An experiment records its question, starting state, interventions, conditions held fixed, repetitions, and evaluation criteria.

Support manual branch comparisons first, then reusable replay batches. Comparisons should vary one factor where practical and disclose additional differences. Blind comparison hides model/version labels until judgments are recorded.

Keep evaluation dimensions separate:

1. Correct speaker identity.
2. Ownership and attribution of claims or experiences.
3. Character distinctiveness.
4. Relevance to the conversation.
5. Coherence and engagement, judged by the user.
6. Capacity for persuasion and development without identity confusion.
7. Personality trajectory and sensitivity to context.

Automated checks may flag issues; human interpretation remains available, including uncertainty and disagreement. Do not collapse all dimensions into one quality score by default.

### 4.9 Dataset curation and training loop

Users can nominate examples from the room, write alternative replies, and compare candidate responses.

Support two dataset intents:

- **Demonstrations:** a recorded input paired with a desired response.
- **Preferences:** the same input paired with preferred and rejected responses, with an optional reason.

Curated examples retain provenance, character/model versions, and whether the target was generated, edited, or written by a human. Corrections to identity must address perspective and claim ownership, not merely replace a speaker label.

Dataset releases are immutable and reviewable before export or submission. Related branches and examples from the same source conversation belong in the same data split to reduce leakage. Reserve unseen conversations and, where appropriate, unseen characters for evaluation.

The initial release exports curated data. A later release submits supported jobs through Together's API, shows job status and available costs, and registers resulting model versions. Model eligibility, data formats, deployment requirements, and pricing must be checked at implementation time. Training and hosted deployment require explicit user initiation; conversation activity must never trigger paid training automatically.

New model versions are evaluated against a baseline before the user adopts them. Preserve the ability to return to an earlier version. Training one shared model to follow varied personas and training a specialized character model are both possible experiment designs; neither is the mandatory default.

## 5. Data and architecture proposal

Extract or reuse the room's existing conversation logic behind a local backend, with browser and optional Discord adapters. The backend owns provider calls, credentials, persistence, and turn execution. The browser owns interaction and presentation.

Proposed storage: a local SQLite database for structured state and append-only research events, with versioned JSON/JSONL and Markdown exports. Final framework and storage selection are implementation decisions.

| Entity | Responsibility |
|---|---|
| Character / CharacterVersion | Stable identity and immutable instruction/settings revisions. |
| Room / Branch / StateRevision | Conversation ancestry and effective state at a point in time. |
| Message / MessageRevision | Visible contributions and retcons with provenance. |
| GenerationAttempt | Exact request, raw result, errors, validation, and retry linkage. |
| MemoryRevision | Per-character, per-branch memory and its source. |
| Observation / Experiment | Evidence, interpretations, interventions, and comparisons. |
| DatasetVersion / TrainingRun / ModelVersion | Curated examples, training lineage, and evaluated results. |

Maintain a strict distinction between the **effective context** presented to a model and the **research record** of what actually happened. Ordinary edits never overwrite evidence. Explicit project deletion may remove records; “append-only” is not a prohibition on user-controlled deletion.

Persist the request before dispatch. Link responses to the state revision that created them, including late/canceled results. Changes during an in-flight turn must not cause the result to be attached to a new revision silently.

## 6. Existing-room migration

Reuse current persona definitions, participant controls, provider routing, speaker selection, reply validation, and snapshot concepts where appropriate. Review their coupling to Discord before reuse; this spec is not a claim that they already support branching.

Import legacy JSON saves without changing originals. Preserve available history, assignments, participant lists, persona overrides, and memories. Mark unavailable prompts, raw replies, intermediate memories, and request settings as unknown. An imported transcript cannot reconstruct missing experimental evidence.

Continue to support the existing Discord workflow during migration. Avoid creating competing browser and Discord writers to the same live room until execution ownership is explicit.

## 7. Release plan and acceptance criteria

### Release 1 — Inspectable conversation workspace

Deliver local browser chat, character editing, participant selection, manual/automatic turns, bounded continuation, persistence, save import, and full attempt inspection.

Acceptance: import an existing save; run a selected character; inspect its exact input and raw output; preserve rejected attempts; restart and recover the same room. No credentials appear in browser payloads or exported records. A failed or late request cannot corrupt the active conversation.

### Release 2 — Branching, retcons, and observation

Deliver state-aware branching, both retcon continuation modes, memory controls, side-by-side comparison, annotations, and notebook export.

Acceptance: branch from an earlier point without inheriting future memory; retcon one branch without modifying its sibling; inspect both original and revised histories; verify that annotation text never enters model context unintentionally. Branch and edit operations themselves make no provider calls.

### Release 3 — Repeatable experiments and datasets

Deliver shared probes, repeated replay, blind comparisons, evaluation dimensions, demonstration/preference editing, and versioned dataset export.

Acceptance: run a documented two-condition experiment; inspect every attempt; compare results with labels hidden; export traceable examples with related branches kept within a single data split.

### Release 4 — Integrated training and model comparison

Deliver verified Together job integration, model version registration, baseline comparisons, and explicit adoption/rollback.

Acceptance: submit a reviewed dataset through a supported training path; preserve job and dataset lineage; evaluate the result on held-out material; use the chosen version in a branch without rewriting earlier runs.

## 8. Product success and limits

The first success test is practical: when a character does something surprising, Deniz can locate the exact conditions, preserve the event, try a controlled variation, and record what the comparison does or does not support without editing source code.

The broader success test is whether observations lead to better experiments and training examples while conversations remain worth having. Measure identity failures alongside distinctiveness and conversational quality so improvements do not merely produce more generic replies.

The product observes model behavior; it does not expose hidden mental states or prove a mechanism from one conversation. Provider changes and stochastic generation can limit reproducibility even when inputs are preserved.

## 9. Open decisions

- Which initial Together model offers the desired conversational quality, training support, and acceptable total cost?
- Should persistent memory initially be manual, generated, or optional in both forms? Proposed starting point: visible, explicitly controlled memory with every update recorded.
- Which identity checks should block a reply versus merely flag it? Proposed modes: protected conversation and observation-only, both retaining raw attempts.
- Should the browser's character limit remain fixed or become configurable? Proposed default: 2,000, with the applied policy recorded per run.
- How much Discord interoperability is useful after browser adoption? Proposed starting point: shared engine and legacy import, without simultaneous live synchronization.
- When should character-specific histories and integrated training move into scope? They are deliberate extensions after reliable state and evidence capture.

No implementation, model purchase, training job, or deployment is authorized by this document alone.
