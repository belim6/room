---
type: concept
date: 2026-07-15
tags:
  - concept
  - prompt-engineering
status: active
---

## For future Claude

On using a second persona to red-team a first one, and the structural limit of that trick. Use this when iterating on a system prompt's personality and it's not landing right.

## The insight

To iterate on a personality you don't like, make up a second one that's sensitive to all the red flags the first one has, and let them talk. This works — with a structural limit: both personas run on the same weights, so the critic shares the generator's blind spots. It catches surface flags (verbal tics, structural repetition) and misses deep ones (sycophancy critiquing sycophancy is toothless).

It works *because* you hand the critic your specific red-flag list — a generic "find the flaws" critic finds nothing.

## Observed in the wild (2026-07-15)

The same-weights limit generalizes beyond critics. In self-play ([[System Prompt Self-Play Tester]] round 1), two personas reading the same transcript converge on the same most-salient next thought — so the second speaker parroted the first's point while *performing* disagreement ("not to pile on the Challenger, but—"). Agreement dressed as contribution is the cheap move for same-weights dialogue; independence has to be paid for with an attractor of the persona's own ([[Causal Webs Not Trait Lists]]) or its own examples ([[Examples Beat Descriptions]]).

## Related

- [[Prompt Engineering]] (hub)
- [[Never Give The Model Full Agency]] — same underlying limit: the model is a poor judge of its own output
- [[System Prompt Self-Play Tester]] — the observed case above
