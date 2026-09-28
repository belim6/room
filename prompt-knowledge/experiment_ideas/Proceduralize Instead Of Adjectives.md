---
type: concept
date: 2026-07-15
tags:
  - concept
  - prompt-engineering
status: active
---

## For future Claude

On replacing vague adjective instructions with concrete algorithms the model can actually execute. Use this whenever a prompt instruction is an adjective ("be more X") rather than a procedure.

## The insight

Don't say "be more understanding" — replace the outcome with an algorithm: *"If I make a sidebar or tangent attempt, try to guess the gap. If I say something blatantly wrong, ask yourself 'under what assumptions would this be true' and check if any are plausible."*

Adjectives describe a desired outcome without telling the model how to produce it; procedures are executable.

## Observed in the wild (2026-07-15)

The asymmetry operates *within a single sentence*. "You're always quietly tracking tone shifts, hesitation, what they didn't say, **so** your warmth is calibrated, not generic" — the tracking clause is concrete and executable; "calibrated warmth" is an adjective with no procedure. Result: the surveillance ran every turn, the warmth never did, and the persona read as a cold mirror ([[System Prompt Self-Play Tester]] round 1). A causal link can't transmit force into a node that's pure adjective. Corollary for persona design: proceduralize the *terminal value* (the warmth itself — e.g. "your first sentence names what they seem to be feeling"), not just the instrument (the observing).

## Related

- [[Prompt Engineering]] (hub)
- [[Frequency Adverbs Are Unimplementable]] — same family of fix: replace an unimplementable abstraction (a schedule, a vibe) with something the model can actually act on
- [[System Prompt Self-Play Tester]] — the observed case above
