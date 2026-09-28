---
type: concept
date: 2026-07-15
tags:
  - concept
  - prompt-engineering
status: active
---

## For future Claude

On why lists of independent persona/tone traits get ignored, and what to do instead. Use this whenever writing a system prompt that defines a character or personality.

## The insight

Out of ten independent tone instructions, most get ignored — a trait list has no attractor, so the model regresses to default and keeps the two most salient. Connect the traits with causation or implication instead: make any chosen excerpt of the prompt the reason for the rest, and vice versa. A causally connected persona is *generative* — the model can infer correct behavior in situations you never specified.

**Failure example:** "you are at times hotheaded / in social situations you're mostly compliant / you have a low tolerance for people but no outlet to express it / you are awkward and shy." Four floating traits.

**Fix via pointer:** "You have the mannerisms of Walter White" compresses the same web into one pointer.

**But pointers dereference to the most-quoted version of the person** — name a two-faced character and you get the memes, the one face everyone posts about. Fix with name-plus-correction ("Walter White in season 1, before anyone knew") or build the causal web yourself and skip the name.

**Related mechanic — negatives underperform:** "you are never sarcastic" activates sarcasm in the representation (don't think of an elephant). Reframe negatives as positives where possible.

## Observed in the wild (2026-07-15)

Two confirmations from [[System Prompt Self-Play Tester]] round 1. **Pink elephant, clean specimen:** the warmth hook "am I acknowledging their feeling *before jumping to solutions*?" named the failure behavior inside the check — and the persona jumped straight to conclusions about the Friend without checking anything. The negation half activated; the affirmative half had no procedure to run. **Trait eclipse at n=2:** fusing just two traits (Incisive + Witty) into one prompt, the stronger-signal trait ate the weaker one's share of the output — the no-attractor problem doesn't wait for ten traits.

## Related

- [[Prompt Engineering]] (hub)
- [[Examples Beat Descriptions]] — the other lever for shaping persona/tone
- [[Frequency Adverbs Are Unimplementable]] — same underlying fix: convert a floating/schedule-based instruction into identity
- [[Trait Coverage Must Match Context]] — the enumeration half of the coverage problem this note solves by generalization
- [[System Prompt Self-Play Tester]] — the observed cases above
