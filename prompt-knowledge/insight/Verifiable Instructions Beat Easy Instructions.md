---
type: concept
date: 2026-07-15
tags:
  - concept
  - prompt-engineering
status: active
---

## For future Claude

On why some prompt instructions get followed reliably and others don't: it's not about difficulty, it's about whether the model can check its own compliance token-by-token. Use this when deciding how to phrase a constraint you actually need followed.

## The insight

Prompts that require no interpretation ("use lowercase only", "end sentences with x") get executed at the highest priority, at the expense of everything else if necessary — not because they're easy, but because they're **verifiable at every token**. The model can check its own compliance continuously, and format-compliance is trained hard because it's the one thing graders can score objectively.

**Corollary:** unfaithfulness to an instruction tracks two different things — genuine difficulty, and conflict with the model's training. These need different fixes:
- Difficulty → fixed with better specification
- Trained-in resistance → fixed by giving the model a legible reason the default behavior doesn't apply here

## Observed in the wild (2026-07-15)

A yes/no self-audit hook ("am I acknowledging their feeling?") is only *weakly* verifiable — it can be satisfied by one token gesture, and in [[System Prompt Self-Play Tester]] round 1 it was satisfied degenerately, with a fabricated acknowledgment of a quote nobody said. Token-level format constraints are the strong form: "your first sentence contains no question mark; at most one question per message" is checkable at every token, so it gets executed at top priority — and can hold a persona's register against an interrogative partner exactly where the mirroring happens.

## Related

- [[Prompt Engineering]] (hub)
- [[License Failure Reporting]] — the flip side: what happens when an instruction *isn't* verifiable or achievable
- [[Position Effects In Long Prompts]] — another "how the model reads" mechanic, not a content mechanic
- [[System Prompt Self-Play Tester]] — the observed case above
