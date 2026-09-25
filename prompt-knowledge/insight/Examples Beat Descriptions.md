---
type: concept
date: 2026-07-15
tags:
  - concept
  - prompt-engineering
status: active
---

## For future Claude

On why models default to generic "beige" output and how to push past it. Use this whenever a prompt is trying to instill taste, tone, or style and description alone isn't landing.

## The insight

Models don't lack taste; they mode-collapse to the median of the genre — everyone's taste averaged into beige. You can customize the taste, but the ceiling via *description* is your own ability to argue an aesthetic position.

The way past that ceiling: **examples beat descriptions**. Three curated examples of the target output transmit taste you can't articulate. Few-shot is the single strongest tone instrument. Describing behavior is the weak half of prompting; demonstrating it is the strong half.

## Observed in the wild (2026-07-15)

In a shared-transcript self-play setup ([[System Prompt Self-Play Tester]] round 1), the other persona's prior turns function as live few-shot examples of "what messages here sound like," while your persona's traits are mere description — and the examples won. The Companion's system prompt *described* warmth; the Challenger's turn *demonstrated* interrogative analysis; the Companion produced interrogative analysis. In multi-agent prompts you're never running description vs. nothing — you're running your description against the context's demonstrations. This is the mechanism behind the register-anchoring hypothesis. Fix: fight examples with examples — put 1-2 messages in the persona's own voice into its system prompt.

## Related

- [[Context Can Imply A Competing Task]] — extends the examples hypothesis from style to task selection; repeated room identity slip, mechanism untested
- [[Prompt Engineering]] (hub)
- [[Causal Webs Not Trait Lists]] — the other lever for shaping persona/tone when description alone fails
- [[System Prompt Self-Play Tester]] — the observed case above

## Observed in the room: vocabulary contagion (2026-09-24)

In two Room [[Werewolf]] games, a single term spread from one character to most of the table within a game. In game 2, "pile" and "shape" were each used by 6 of 7 characters, although all 7 have distinct persona descriptions. The transcript acted as few-shot examples of how people talk in that room. See [[Transcripts Grow Their Own Vocabulary]], including the model confound.
