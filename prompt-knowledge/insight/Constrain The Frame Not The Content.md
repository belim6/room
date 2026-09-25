---
type: concept
date: 2026-07-15
tags:
  - concept
  - prompt-engineering
status: active
---

## For future Claude

On the limits of over-specifying a prompt, even when the system prompt is otherwise good. Use this when tempted to lock down exactly what the output should say.

## The insight

A good chunk of getting good replies is having good inputs — garbage in, garbage out, even with a perfect system prompt. If you already know the reply you're looking for, reverse-engineer the system prompt from it.

But distinguish two cases:
- If you *fully* know the target output, the model is a typist and the value-add is zero no matter how well it performs.
- The real risk of over-constraining is different: it **collapses the output distribution and kills the surprise**, which is where the actual value lives.

**Rule of thumb:** constrain the frame, not the content.

## Observed in the wild (2026-07-15)

The flip side: the frame you *don't* choose still constrains. A transcript with labeled speakers ("The Challenger:", "The Companion:") recruited the panel-discussion genre, and the Companion behaved like a panelist — meta-commentary about the discourse ("that feels like the real hinge here") aimed at the other panelist, instead of talking to the Friend ([[System Prompt Self-Play Tester]] round 1). Formats carry genres; genres supply behavior; if the prompt doesn't set the frame, the format sets it for you. Fix: "you're in a group chat with your friend — talk to *them*, not about the conversation." (Filed here as the closest category; loosest fit of the round-1 post-mortem set — split into its own note if it recurs.)

## Related

- [[Prompt Engineering]] (hub)
- [[System Prompt Self-Play Tester]] — the observed case above
