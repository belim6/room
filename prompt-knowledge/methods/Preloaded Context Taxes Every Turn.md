---
type: concept
date: 2026-07-16
tags:
  - concept
  - prompt-engineering
  - systems
status: active
confidence: mixed - see per-claim markers
ai-first: true
---

## For future Claude

Dropped by Deniz 2026-07-16 as one of the two seeds for [[Prompting For Systems]]. Use this whenever deciding what goes into an always-loaded file (CLAUDE.md, agents.md, a system prompt) versus what gets loaded on demand (a skill, a tool, a linked note).

## The claim (owner-stated, verbatim)

> *"Skills cost ~53 tokens per turn vs 944+ for equivalent agents.md entries. That gap destroys performance on long sessions."*

**Confidence: stated.** The specific numbers are Deniz's, source not given — **attribute them to him, or re-verify before citing them to anyone else.** The mechanism below is independently sound regardless of whether the figures are exactly 53 and 944.

## The mechanism

Two ways to give a model a capability:

1. **Preload it.** Put it in a file that's read into context every turn — CLAUDE.md, agents.md, the system prompt. The model always knows it. You pay for it **every single turn, whether or not it's relevant.**
2. **Disclose it progressively.** Put it behind a name and a one-line description — a skill, a tool schema, a linked note. Per turn you pay only for the *pointer*. The body loads only when something actually invokes it.

The gap is not the point. **The compounding is.** A preloaded entry is a per-turn tax levied for the whole session; a pointer is a one-line tax plus an occasional lump sum. Over a long session the preloaded version costs roughly `cost × turns` while the lazy version costs roughly `pointer × turns + body × uses`. When `uses << turns` — which is the normal case, because most capabilities are irrelevant most of the time — the difference isn't a percentage, it's an order.

## Why it "destroys performance," not just budget

The token cost is the visible half. The invisible half is worse and it's already documented in this vault:

- **[[Position Effects In Long Prompts]]** — instructions at the start and end get followed; the middle gets lost. Every preloaded entry you add pushes something else into the middle. **You aren't just paying tokens, you're spending the only two positions that reliably work.**
- Context spent on capabilities the turn doesn't need is context not spent on the turn's actual material.

So the failure isn't "we ran out of room." It's that turn 200 quietly follows fewer of its instructions than turn 2 did, and nothing announces it.

## The rule

**Preload only what every turn needs. Everything else gets a pointer.**

This vault already runs on it, deliberately: [[CRITICAL_FACTS]] is kept small *because it loads every session*, while [[Career]] — bigger, and needed only for job-search questions — sits behind a pointer in it. `/obsidian-world`'s L0/L1/L2/L3 ladder is the same idea as a loading discipline. **The vault is an instance of this note.**

## Open questions

- Where do the 53 / 944 figures come from? Deniz didn't say. Re-verify before they leave this vault.
- What's the crossover point? If `uses / turns` is high enough, preloading wins. Nobody has measured where the line sits.
- Does the same argument apply *within* a preloaded file — i.e. is a terse CLAUDE.md with pointers to notes strictly better than a fat one? Probably, but untested.

## Related

- [[Prompting For Systems]] (hub)
- [[Position Effects In Long Prompts]] — the mechanism behind "destroys performance"
- [[Feed Every Failure Back Into The System]] — the other seed; in tension with this one, since a permanent failure log grows forever and something has to keep it from becoming the tax described here
