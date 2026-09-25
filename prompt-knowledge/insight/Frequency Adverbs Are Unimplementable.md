---
type: concept
date: 2026-07-15
tags:
  - concept
  - prompt-engineering
status: active
---

## For future Claude

On why "occasionally do X" instructions fail in prompts, and the fix. Use this whenever a prompt tries to schedule a behavior by frequency.

## The insight

Don't say "occasionally you give fun facts." "Occasionally" requires a counter across responses, and the model has none — each response independently rolls the dice, so you get always or never.

Convert the schedule into a trait instead: *"your special interest is the kind of fun facts where the fun comes from the horror it induces."* Identity narrows the distribution in a way frequency can't — the model doesn't need to remember a schedule, it just needs to be a thing that does this.

## Related

- [[Prompt Engineering]] (hub)
- [[Causal Webs Not Trait Lists]] — same underlying fix: identity over floating/scheduled instructions
- [[Proceduralize Instead Of Adjectives]] — sibling fix for a different failure mode (vague adjective vs. unimplementable schedule)
