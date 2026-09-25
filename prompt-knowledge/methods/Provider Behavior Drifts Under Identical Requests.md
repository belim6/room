---
type: concept
date: 2026-09-24
tags:
  - concept
  - systems
  - experiments
  - provider
evidence: observed
confidence: one clear instance; cause on the provider side unknown
ai-first: true
---

## For future Claude

A methods lesson from Room. It changed how experiments are recorded and compared (`EXPERIMENTS_SPEC.md` §8–9). Belongs to the [[Prompting For Systems]] half: it's about whether a *measurement system* stays valid over time.

## The observation

[[Exp1 Deduction Before Vote]] (23 Sep, ~22:49 UTC) and [[Exp2 Deduction Before Vote Replication]] (24 Sep, ~13:21 UTC) sent **byte-identical requests**: the same system message, user message, model ID (`deepseek/deepseek-v4.1-flash-ultrafast`) and temperature. Only the date and time differed.

- **Median completion tokens,** condition C: 1,413 → 815.
- **Median completion tokens,** condition A: 1,411 → 1,016.
- **Outcomes shifted with it** ([[Short Reasoning Joins The Pile]]).

The responses carry no fingerprint, provider or backend field (keys: `id, object, created, model, choices, usage`), so the cause can't be identified: load, backend routing behind the "ultrafast" route, or a silent model update.

## Third data point (2026-09-24, [[Exp3 Reasoning Off]])

The control's median completion tokens were 1,411 (Exp1, 23 Sep) → 1,016 (Exp2, 24 Sep 13:21) → 1,457 (Exp3, 24 Sep ~16:30). Its off-pile rate moved with it: 0/5 → 3/20 → 12/40. Drift runs in both directions, within a single day.

## Rules that follow

1. **A replication is a new run, not more of the same data.** Never pool counts across experiments, even with identical designs. Show each run's time window next to its results.
2. **Record the variables you don't control.** Reasoning length, latency and served-model string go in every results table, per trial. They're the only way to notice drift.
3. **Run conditions interleaved, in one window.** Within one experiment, conditions run in parallel, so drift hits all of them equally. Comparing conditions *across* experiments inherits the drift.
4. **Check the knob before trusting it.** A parameter can be accepted and ignored ([[Probe OpenGateway Reasoning Effort]]).

## Related

- [[Prompting For Systems]] (hub) · [[Room Ledger]]
- [[Feed Every Failure Back Into The System]]: this note is leg 3. The failure became spec rules §8–9.
