---
type: concept
date: 2026-09-14
tags:
  - concept
  - prompt-engineering
  - model-behavior
status: hypothesis
confidence: observed identity mismatch; proposed mechanism and cross-task generalization untested
---

## For future Claude

Developed with Deniz from a repeated speaker-identity failure in the Discord room. Deniz explicitly requested an insight applicable beyond group conversations. The room is also an experimental apparatus: preserve surprising behavior before intervening. Use this note when an output fits the supplied material but fails the operation or role explicitly assigned.

## The hypothesis

**Context can imply a task that competes with the task explicitly assigned.**

Examples, format, and conversational expectations may supply an implicit specification of what a successful next response looks like. A model can produce a locally plausible continuation while violating its assigned operation or identity.

This extends [[Examples Beat Descriptions]]: examples may demonstrate **which activity to perform**, beyond demonstrating how to perform it. The relevant prompting question is therefore: what relationship should the model have to the supplied material—continue it, evaluate it, transform it, classify it, or respond from a particular position?

This is a behavioral hypothesis, not a claim of access to the model's internal experience or a proven general mechanism.

## Observed case: the room (2026-09-14)

Eight personas shared a transcript and used the configured model `moonshotai/kimi-k3-ultrafast` through OpenGateway. Requests used temperature 0.7 and a 2,000-character output cap. Each call supplied the selected persona's description in the system message and the shared transcript as one user message. At the time of the failure, the transcript was not followed by an explicit instruction naming the next speaker.

The discussion concerned Peter Thiel and the antichrist as a theological thought experiment. Rook developed the comparison; Elorin established a skeptical counterposition. After another escalation from Rook:

- **Jonas:** Deniz reports that Jonas spoke from Elorin's perspective. He manually deleted the faulty reply to continue the conversation. `jonasfuckedup.json` retains `lastSpeaker: Jonas` but no Jonas reply. This instance is user-reported, not independently recoverable from that snapshot.
- **Velric:** the next saved failure contains an explicit nested attribution: `Velric: Elorin: Rook, you've built a clock that only strikes midnight...`. The application selected and recorded Velric; the generated text labeled itself Elorin and argued the skeptical position.

These are two reported failures at the same conversational junction, with one verbatim saved specimen. They are not a controlled experiment or an estimate of failure frequency.

## Interpretation and alternatives

Deniz's interpretation: the narrative seemed to demand an answer from Elorin more strongly than the persona instructions demanded Jonas or Velric. Elorin had an enacted identity—prior claims and relationships—while Jonas had not yet spoken in the saved history. Deniz suggested that entering without an introduction might also matter. Velric had spoken earlier, so absence of an introduction cannot alone explain both cases.

One candidate explanation is that the model selected the most fitting continuation of an ensemble conversation rather than composing the assigned participant's next contribution. Other explanations remain open: speaker-label imitation, recency, prompt placement, stylistic copying, and insufficiently distinct persona conditioning. A wrong label alone does not prove wholesale adoption of another perspective.

## Possible applications beyond the room

These are predictions to test, not additional observations:

- **Document review:** a proposal's persuasive momentum draws the reviewer into extending its argument.
- **Classification:** a question inside the material elicits an answer instead of a label.
- **Editing:** surrounding examples supply a voice that displaces the author's requested voice.
- **Decision support:** an apparent emerging consensus draws the model into advancing a conclusion it was asked to evaluate.

The common test is whether the model performs the assigned operation or the operation suggested by the material.

## Intervention and measurement

The implemented mitigation explicitly names the selected speaker in the system prompt and after the quoted transcript, allows entry without an introduction, and rejects explicit mismatched persona labels with one retry. Redundant correct labels are stripped.

Local mocked checks established that the guard rejects the saved Velric specimen and preserves the character limit. **They did not establish that the model now maintains perspective.** As [[Contrast Sentences Are The Tell]] warns, removing a detectable surface form can leave the underlying behavior intact.

At implementation time the retry guard did not retain rejected reply bodies. That loses research evidence. Future instrumentation should preserve exact requests, raw responses, selected identity, model/settings, rejected attempts, and retries separately from the conversation shown to participants.

For a controlled replay, hold the transcript, model, and sampling settings constant; vary only the named persona or the explicit next-turn framing. Repeat each condition. Score speaker labels separately from perspective adoption, claimed ownership of earlier statements, and substantive response quality. Test introduction history and transcript format separately. Preserve pre-intervention conditions so a mitigation remains comparable with its baseline.

## Sources

- Conversation with Deniz, 2026-09-14: observed failure, deletion clarification, research purpose, and request to generalize.
- [Velric failure snapshot](/Users/denizyuksel/Desktop/dc/room/saves/velricfuckedup.json)
- [Jonas snapshot after manual deletion](/Users/denizyuksel/Desktop/dc/room/saves/jonasfuckedup.json)

## Related

- [[Prompt Engineering]] — hub
- [[Examples Beat Descriptions]] — context demonstrates behavior and may also imply the task
- [[Constrain The Frame Not The Content]] — formats recruit genres and behavioral expectations
- [[Position Effects In Long Prompts]] — competing explanation to test
- [[Contrast Sentences Are The Tell]] — surface compliance can conceal the same behavior
- [[Feed Every Failure Back Into The System]] — preserve observations as well as fixes

## Observed in the room: claim ownership (2026-09-24)

A second specimen, from [[Werewolf]] game 2 in Room (DeepSeek), about *credit* rather than identity. Deniz, playing the seer, cleared Velric and was eliminated. On Day 2, Alexandra spoke first and restated it ("Deniz was the seer and he scanned Velric"). Velric spoke next: *"Alexandra's cleared me, so let me spend that credit…"*.

Velric's hidden reasoning had it right: *"I'm a villager, confirmed by Deniz's seer claim. Alexandra has cleared me."* The correct source appeared first, then a compressed version credited the most recent speaker, and the spoken reply kept only the compressed version. This fits the proximity reading here: the nearest speaker absorbs the claim. It also shows the error can form *inside the reasoning* and survive into the reply, not only at the output step.

Evidence: observed, n = 1, eliminated human player as the original source. Test design: item 6 in the [[Room Ledger]] queue.
