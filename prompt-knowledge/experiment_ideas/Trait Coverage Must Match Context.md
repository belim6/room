---
type: concept
date: 2026-07-15
tags:
  - concept
  - prompt-engineering
status: active
---

## For future Claude

Owner-original technique (first one in this vault derived from the owner's own experiment rather than an ingested source), from the [[System Prompt Self-Play Tester]] round-1 post-mortem, 2026-07-15. Use this when a persona behaves "in character but wrong" — a trait over-applied outside its lane.

## The insight

A persona's instructions are handlers for situations. With too few handlers, every situation the conversation throws gets forced through the nearest available instruction: the round-1 Companion had essentially one executable behavior (track subtext), so every turn got the subtext-detector treatment, and warmth surfaced as cold mirroring. Pile up more instructions and each starts getting used more adequately — not because more text is better, but because situations land on better-fitting handlers instead of being crammed through the only one that exists.

The Challenger looked like a counterexample (also just two traits, held up fine) but isn't: the seed context — a friend weighing a risky decision — sat squarely inside its coverage, so incisive-poking was exactly what the situation called for. It got to achieve its potential. Owner's prediction (untested, speculation): move the context outside its coverage — idle gossip, comfort-seeking, celebration — and the Challenger misfires the same way, in character but socially wrong, because its instructions aren't equipped for that situation.

## How this composes with causal webs

[[Causal Webs Not Trait Lists]] solves coverage by *generalization* — a causal web is generative, the model infers behavior in situations never specified. This technique solves it by *enumeration* — more handlers. They compose: a compiler ([[Persona Trait Compiler]]) should build the web for generalization AND audit coverage against the situations the target context will actually throw. Tension to manage while enumerating: a pile of *independent* handlers re-creates the trait-list salience problem, and [[Position Effects In Long Prompts]] applies as the pile grows — weave added handlers into the web, don't stack them.

## Rival hypothesis + the experiment that decides

Claude's alternative read of round 1: warmth failed because it runs against the model's default analytical attractor ("against the grain"), not because of handler count. Discriminating test for round 2+: give the Companion a dense set of warm handlers but no own-voice examples and no token-level format constraints. If dense coverage alone holds warmth against an interrogative partner, the coverage thesis wins; if it still gets pulled, anchoring needs the heavier tools ([[Examples Beat Descriptions]], [[Verifiable Instructions Beat Easy Instructions]]). Second probe: the owner's context-swap — run the Challenger somewhere its handlers don't reach and watch for the misfire. (confidence: stated by owner; experiments pending)

## Related

- [[System Prompt Self-Play Tester]] — the source experiment and where the tests will run
- [[Causal Webs Not Trait Lists]] — the generalization half of the same coverage problem
- [[Persona Trait Compiler]] — gains a coverage-audit requirement from this
- [[Prompt Engineering]] (hub)
