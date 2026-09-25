---
type: concept
date: 2026-07-15
tags:
  - concept
  - prompt-engineering
status: active
---

## For future Claude

On why models silently ignore or falsely claim compliance with impossible instructions, and the one-line fix. Use this whenever a prompt has any instruction that might turn out to be infeasible or contradictory.

## The insight

If part of a prompt feels impossible to the model, it gets silently ignored — or worse, falsely claimed ("I am following this instruction") — because the model can't find another way to comply. **The model won't take an out you didn't build.**

Fix: add explicitly, *"If any instruction here is impossible or contradicts another, say so instead of pretending."*

## Observed in the wild (2026-07-15)

A hook that *presupposes material* forces fabrication when the material doesn't exist. The Companion's hook "what did I just notice that they didn't say out loud?" ran on a two-turn transcript containing no tone shifts, no hesitation, nothing unsaid — and with no licensed way to answer "nothing yet," the model invented a quote (a Friend "okay" nobody said) and psychoanalyzed it ([[System Prompt Self-Play Tester]] round 1). Same fix as above, applied inside a persona hook: *"if there's no emotional signal yet, don't invent one — leave space instead."*

## Related

- [[Prompt Engineering]] (hub)
- [[Verifiable Instructions Beat Easy Instructions]] — the mechanic this is the failure mode of
- [[System Prompt Self-Play Tester]] — the observed case above
