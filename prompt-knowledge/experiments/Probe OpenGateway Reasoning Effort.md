---
type: experiment
date: 2026-09-24
tags:
  - experiment
  - provider
  - reasoning
evidence: observed
verdict: effort parameters ignored; thinking off works
ai-first: true
---

## For future Claude

A quick capability probe, not a Room experiment record. The calls went directly to OpenGateway, outside the app, so no attempts are stored in Room. Rerun it before relying on it, since providers change.

## Setup

`deepseek/deepseek-v4.1-flash-ultrafast` via `https://apis.opengateway.ai/v1/chat/completions`, temperature 0.7.

1. **Easy puzzle:** one call each for baseline, `reasoning_effort: low|high`, `reasoning: {effort: low|high}`, `thinking: {type: disabled}`, and `reasoning_effort: "bogus_value"`.
2. **Harder logic puzzle:** 4 calls each for the four effort variants.

## Results

- **`thinking: {type: "disabled"}` works:** 0 characters of `reasoning_content`, and a correct answer on the easy puzzle.
- **Effort settings have no effect.** Completion tokens over 4 repeats on the harder puzzle:
  - `reasoning_effort` low: 359, 354, 345, 430
  - `reasoning_effort` high: 346, 359, 386, 419
  - `reasoning.effort` low: 356, 388, 409, 431
  - `reasoning.effort` high: 281, 355, 371, 427
- **An invalid effort value is accepted silently.**

## Consequence

Reasoning length can be turned off, but not dialed up or down, on this route. The Room spec (§7) therefore offers only `default | off`, and refuses to send unverified switches to other providers.

## Related

- [[Room Ledger]] · [[Short Reasoning Joins The Pile]] · [[Provider Behavior Drifts Under Identical Requests]]
- [[License Failure Reporting]]: the gateway's silent acceptance of an invalid value is the API-level version of an unlicensed failure.
