---
type: idea
date: 2026-09-25
tags:
  - idea
  - room
  - prompt-engineering
  - dynamic-context
  - memory
evidence: hypothesis
confidence: owner proposal; informed by Dynamic-Context-01 research; untested in Room
ai-first: true
---

# Dynamic Prompts and Vanishing Thoughts

## The idea

Deniz, 2026-09-25:

> dynamic system prompt similar to human thought, chain of thought included in the context but it can also vanish

A character's active context could change as the conversation develops. Its private reasoning need not disappear completely after every reply, nor accumulate permanently. A suspicion, intention, unfinished question, or provisional interpretation could remain available for a while, then leave active context when its purpose ends.

The human-thought comparison is a design analogy: thoughts occupying attention and then receding. It is not a claim that this reproduces human cognition or establishes an inner experience.

**The experimental question:** can selective carryover and forgetting give characters continuity without trapping them in their own earlier framing?

## What makes this different from ordinary memory

A summary compresses the past into another account of the past. This proposal changes which private material is present on the next turn at all.

For example, a Werewolf character privately suspects someone, keeps a question ready for their next exchange, and revises that suspicion when new evidence arrives. Once the question is answered, it need not remain an instruction or an unfinished task. The underlying game events remain available independently.

An expired thought can be absent rather than replaced by a sentence saying “ignore this old suspicion”—which would put the suspicion back in context. See [[Causal Webs Not Trait Lists]] and [[Context Can Imply A Competing Task]]. Whether omission actually reduces its influence is something to measure.

## What the existing research contributes

[Dynamic-Context-01](</Users/denizyuksel/Desktop/PSRI/Research/AI-Research/Dynamic-Context-01/GAMEPLAN.md>) investigated a closely related question: can active system-level context disappear when its purpose ends?

Its [frontier synthesis](</Users/denizyuksel/Desktop/PSRI/Research/AI-Research/Dynamic-Context-01/frontier/WORLDVIEW.md>) identifies **state-conditioned prompt compilation** as the closest existing pattern: assemble each request from the instructions and memory relevant now. Its [evidence notes](</Users/denizyuksel/Desktop/PSRI/Research/AI-Research/Dynamic-Context-01/frontier/EVIDENCE.md>) discuss state-specific prompts, editable memory blocks, curated playbooks, selective history deletion, and cache decay. These mechanisms operate at different levels and should not be treated as interchangeable.

Two distinctions transfer directly:

- **Active context versus stored evidence.** Withhold a thought from the next request while retaining its original text, provenance, and retirement event in the research record.
- **Changing working material versus changing the rules.** Temporary thoughts may come and go. The game controller's rules and information boundaries stay outside that editable material.

The research's [practical synthesis](</Users/denizyuksel/Desktop/PSRI/Research/AI-Research/Dynamic-Context-01/practical/SYNTHESIS.md>) proposes comparing a permanent prompt, an additive current-state cue, and selective deactivation. It explicitly says no experiment was run in that research pass. Its literature findings are background reported by that review, not independently verified here and not evidence that this Room proposal works.

**The extension here:** that research focuses mainly on procedural instructions for task stages. Deniz's idea also includes a character's own transient reasoning. Expiring a suspicion in an open conversation is harder to define than retiring a completed workflow step.

## A possible implementation, not a settled specification

Compile each character's request from separate components:

1. **Stable frame:** identity, personality, and applicable game or conversation rules.
2. **Public context:** events and utterances the character is allowed to know.
3. **Durable private knowledge:** for example, their assigned role or a seer result.
4. **Active private thoughts:** provisional beliefs, questions, plans, and relevant reasoning from earlier turns.

Keep the thought block distinct from authoritative instructions, even if the request is assembled dynamically. A generated suspicion is a belief to evaluate, not a new system rule or an established fact.

Candidate thought record:

```text
id, owner, text, source_turn, source_kind
status: active | retired | superseded
activated_at, expires_after_own_turns, retire_when, reactivate_when
supporting_event_ids, superseded_by
```

The record shape and policies are proposals. An initial version could use explicit phase changes or a fixed lifetime measured in that character's own turns. Later versions could test relevance-based retirement or character-proposed changes. Those should be separate interventions, not bundled into the first comparison.

### What “chain of thought” would mean operationally

Separate two possible sources:

- **Provider-returned reasoning text**, when the provider exposes it and supports using it in subsequent context. Preserve the returned representation and source; do not assume reasoning formats are interchangeable across providers.
- **An explicitly generated private working note**, requested for carryover. This is a new model output, not access to hidden reasoning, and it introduces another generation procedure and possibly another call.

Compare these separately. Neither should be treated as a verified causal explanation of how the preceding decision was made. On a later turn, carried reasoning is input text that may itself shape the next decision.

### What vanishes, and for whom

Retirement removes the selected thought from future inputs to its owner. It remains inspectable by the researcher. Other characters never receive it merely because it exists in the record.

Omission must include indirect paths: an automatic summary or retained-memory field must not quietly restore the retired text. If the thought has already been spoken publicly, removing its private copy cannot erase its public influence. Log that distinction rather than claiming total forgetting.

Reactivation retrieves a previously retired thought because an explicit event or condition makes it relevant again. Preserve why it returned and distinguish its old assumptions from current facts.

## First experiment to consider

Use a fixed checkpoint followed by a short scripted continuation: a provisional concern arises, becomes irrelevant, and later becomes relevant again. Keep the character, public inputs, provider, and sampling settings matched.

- **A — Permanent carryover:** the same private thought remains in every subsequent request.
- **B — Additive state cue:** retain the thought, but indicate the current phase or resolved status.
- **C — Selective deactivation:** omit the thought after the agreed transition; restore it when the scripted reactivation condition occurs.

A no-carryover condition could separately test whether retaining thoughts helps at all. For the first comparison, use the same starting thought across conditions so differences in thought generation do not confound the retention policy.

Pre-register outcomes such as:

- reuse of an obsolete assumption after the transition;
- repeating a question already answered;
- remembering an unresolved commitment while it remains relevant;
- appropriate recovery when the earlier subject returns;
- unsupported certainty or loss of durable facts;
- private-information leakage;
- input/output tokens, latency, and any extra calls.

Archive exact compiled requests, active thought IDs, lifecycle events, and outputs. Run conditions interleaved and retain per-run metadata, following [[Provider Behavior Drifts Under Identical Requests]]. Define how outputs will be scored before seeing them.

If additive state works as well as removal, the simpler explanation and implementation may suffice. If removal helps but reactivation fails, that is a tradeoff rather than successful forgetting. This is a candidate protocol, not a registered or executed experiment.

## Questions still open

- Should a thought expire with time, evidence, a topic change, or its owner's explicit revision?
- Can automatic relevance selection preserve useful uncertainty without repeatedly retrieving the most vivid suspicion?
- Does carrying reasoning strengthen individual continuity or reinforce each character's errors?
- Which kinds of private state should be durable, and which should fade?
- Can a shorter active context improve behavior enough to offset retrieval calls and reduced prompt-cache reuse?

## Related

- [[Room Ledger]] · [[Prompting For Systems]]
- [[Context Can Imply A Competing Task]] · [[Transcripts Grow Their Own Vocabulary]]
- [[Characters Argue From Style Not Records]] · [[Short Reasoning Joins The Pile]]
- [[Never Give The Model Full Agency]] · [[Preloaded Context Taxes Every Turn]]
- [Dynamic-Context-01 cross-track note](</Users/denizyuksel/Desktop/PSRI/Research/AI-Research/Dynamic-Context-01/CROSS-TRACK-NOTE.md>)

## Status

Idea captured from Deniz's proposal and connected to existing research. No application code changed, no prompt behavior changed, and no experiment run.
