---
type: concept
date: 2026-07-16
tags:
  - concept
  - prompt-engineering
  - systems
  - hub
status: active
ai-first: true
---

## For future Claude

**Hub for the systems half of prompting.** Sibling to [[Prompt Engineering]], created 2026-07-16 at Deniz's request — his framing, verbatim: *"the prompting tips in knowledge are all about chatbots, we need a separate prompting tips for systems."*

**The split:** [[Prompt Engineering]] is about making a model *say* the right things — persona, voice, traits, register. **This hub is about making a system that keeps working over time** — token economy, specs, memory, failure loops, what's in the context window and what it costs you every turn. The field mostly calls this *context engineering* or *agent architecture*; search both terms if this hub doesn't surface.

The rough test for which hub a note belongs to: **does it change what the model says, or does it change what the system can still do on turn 200?**

## The techniques

- [[Preloaded Context Taxes Every Turn]] — a skill costs ~53 tokens/turn until invoked; an equivalent always-loaded entry costs 944 every turn regardless. The tax compounds and the bill arrives late.
- [[Feed Every Failure Back Into The System]] — Karpathy's loop: spec before you start, scratchpad while you work, and every failure written back permanently. The third leg is the one that compounds.

## The split isn't clean (noted 2026-07-16, worth revisiting)

Several notes currently filed under [[Prompt Engineering]] are really systems notes wearing chatbot clothes:

- **[[Never Give The Model Full Agency]]** is the clearest case. It's filed with the persona techniques, but the thing it just caught (2026-07-16) was a **business workflow** — the anti-confabulation guard in [[Lemontaps Application]] living in a prompt, where the model self-reports its own `konfidenz`, while the one deterministic check sat computed and unwired. That's not a chatbot failure. That's a systems failure, and the note that predicted it is in the wrong pile.
- [[Verifiable Instructions Beat Easy Instructions]], [[License Failure Reporting]], and [[Position Effects In Long Prompts]] straddle both.

**Don't move them yet** — a note can be linked from two hubs, and the retrieval cost of a wrong move is higher than the cost of a note appearing twice. Revisit once this hub has enough notes to have its own center of mass.

## Related

- [[Prompt Engineering]] — the behavior/persona half
- [[Lemontaps Application]] — where the systems/chatbot distinction first paid rent
