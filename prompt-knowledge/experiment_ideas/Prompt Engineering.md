---
type: concept
date: 2026-07-15
tags:
  - concept
  - prompt-engineering
  - hub
status: active
---

## For future Claude

Hub note for everything the owner collects on prompt engineering. Individual techniques live in their own atomic notes (linked below) so each can be retrieved alone; this note is the map plus the one meta-insight that ties them together. Start here, then follow a link for depth.

## The techniques

- [[Context Can Imply A Competing Task]] — hypothesis from the room (2026-09-14): contextual cues may imply an activity that competes with the explicitly assigned task
- [[Verifiable Instructions Beat Easy Instructions]]
- [[License Failure Reporting]]
- [[Examples Beat Descriptions]]
- [[Causal Webs Not Trait Lists]]
- [[Constrain The Frame Not The Content]]
- [[Critic Personas Debug Personalities]]
- [[Never Give The Model Full Agency]]
- [[Proceduralize Instead Of Adjectives]]
- [[Frequency Adverbs Are Unimplementable]]
- [[Position Effects In Long Prompts]]
- [[Trait Coverage Must Match Context]] — owner-original, from the round-1 self-play post-mortem (2026-07-15), not from the ingested protips
- [[Contrast Sentences Are The Tell]] — owner-original, from live multi-agent [[DnD]] play (2026-07-15)
- [[Instructions To Disagree Become Dispositions]] — owner-original, from Deniz specifying how Claude should push back on them (2026-07-16); the fix is now the pushback rule in [[SOUL]]

## The organizing split

Half of prompting is **what to write** ([[Examples Beat Descriptions]], [[Causal Webs Not Trait Lists]], [[Constrain The Frame Not The Content]], [[Never Give The Model Full Agency]], [[Critic Personas Debug Personalities]], [[Proceduralize Instead Of Adjectives]], [[Frequency Adverbs Are Unimplementable]], [[Trait Coverage Must Match Context]]). The other half is **how the model reads** what you wrote ([[Verifiable Instructions Beat Easy Instructions]], [[License Failure Reporting]], [[Position Effects In Long Prompts]] — verification, statelessness, silent failure, negation, position). Most bad prompts fail on the second half, which is invisible until you name it: the content can be perfect and the prompt still fails because of *where* an instruction sits, whether it's checkable, or whether the model was given a legal way to say "I can't."

The two owner-original notes from 2026-07-15/16 may be pointing at a **third** category the ingested protips never named: *layers nobody wrote to get filled by the default.* [[Contrast Sentences Are The Tell]] — no prompt owned sentence shape, so every character converged on the model's default rhetoric. [[Instructions To Disagree Become Dispositions]] — a conditional had no branch to attach to, so it spread into a global trait. In both cases the failure isn't in what was written or how it was read, but in what was *left unspecified* and silently filled. Open question flagged in both notes: same mechanism, or two? If one, they merge.

## Related ideas

- [[Persona Trait Compiler]] — an old draft persona-design doc, dissected 2026-07-15; the trait-list problem several techniques above solve, found in an actual owner artifact
- [[Persona Trait Library]] — the curated good lines pulled out of the owner's archives, growable
- [[Narrative Characterization Vs Procedural Instruction]] — a second archive uses a completely different technique (narrative description vs. explicit instruction); when each style needs a strong model to land

## Source

Dropped as a curated protips file by the owner, 2026-07-15. Split into atomic notes here rather than kept as one document, per this vault's `_CLAUDE.md` thought-dump workflow.
