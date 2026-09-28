---
type: experiment
date: 2026-09-28
kind: probe
tags:
  - experiment
  - room
  - reasoning
  - style
evidence: observed
verdict: Deniz's 10/10 prediction refuted; the direction holds (2/10 → 6/10 lowercase)
room:
  experiment: B2 · Boris lowercase · reasoning off a47a30ae (linked under B1 · Boris e5b735c6)
  base: 24675520 @ aa7cdcc5 (B1 checkpoint)
model: opengateway / deepseek/deepseek-v4.1-flash-ultrafast, temperature 0.7
ai-first: true
---

## For future Claude

A sibling probe of [[B1 First Replies]]. In B1, Boris's prompt says "Lowercase", but he started lowercase in only 3/10 replies. Deniz read the reasoning and noticed that the instruction was left out of it in every capitalized reply. Claude's check: 5/5 replies with no mention were capitalized, and 3 of the 5 with a mention were lowercase. So a mention looked necessary but not sufficient.

## Prediction (Deniz)

With reasoning off, Boris starts lowercase 10/10. The control stays near 3/10.

## Design

The B1 checkpoint. A_control (reasoning on, a rerun in this window) vs B_reasoning_off, 10 each, run concurrently with B3 on 2026-09-28 at about 14:40 UTC.

## Results

| | First letter lowercase | Whole reply lowercase |
|---|---|---|
| A_control | 2/10 | 2/10 |
| B_reasoning_off | **6/10** | 5/10 |
| B3 A_full, same window, reasoning on | 3/10 | 3/10 |
| B3 B_persona_only, reasoning on, no global system prompt | **6/10** | 6/10 |

- With reasoning off, **5/10 replies came wrapped in quote marks**. That's a new failure, probably mimicking the request's `Shared conversation (quoted context …)` framing.
- In the control, a mention of lowercase in the reasoning again didn't guarantee a lowercase reply (1 of 5 mentions came out lowercase).

## Verdict

- **Refuted as predicted (10/10).** The direction is supported: 2 → 6, one-sided Fisher p ≈ 0.09, n = 10. Probe level, `observed`.
- **Removing the global system prompt gave the same lift** (6/10) with reasoning on. The lowercase instruction competes with the rest of the context, and reasoning is one of two things that dilute it.
- Not tested: whether putting the style rule last, or stating it as a hard format rule ("write entirely in lowercase"), fixes it with reasoning on.

## Related

- [[B1 First Replies]] · [[B3 Where The Topics Come From]] · [[Short Reasoning Joins The Pile]] · [[Exp3 Reasoning Off]]
