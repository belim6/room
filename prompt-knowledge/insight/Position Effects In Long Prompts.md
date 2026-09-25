---
type: concept
date: 2026-07-15
tags:
  - concept
  - prompt-engineering
status: active
---

## For future Claude

On where to place load-bearing instructions in a long prompt. Use this when a prompt has many instructions and some seem to get dropped.

## The insight

Instructions at the start and end of a long prompt get followed; the middle gets lost. If a ten-point prompt keeps points two and nine and drops the rest, that's serial position at work, not just competition between instructions for the model's attention (the "attractor problem"). Put the load-bearing instructions first and last.

## Related

- [[Prompt Engineering]] (hub)
- [[Verifiable Instructions Beat Easy Instructions]] — another "how the model reads" mechanic, orthogonal to content
