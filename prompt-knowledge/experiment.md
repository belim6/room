---
type: method
date: 2026-09-28
tags:
  - method
  - room
  - experiments
status: active
ai-first: true
---

## For future Claude

Ground rules for every experiment run in Room from 2026-09-28 on. Read this before designing, running or writing up an experiment. The werewolf series (Exp1–Exp5) was run before these rules existed. In hindsight it was a shakedown of the experiment feature itself, and the lessons from it are built in below.

**The purpose is practical.** The research feeds prompt engineering, not publications. We use the scientific method where it protects a *decision*, and loosen it where it would only protect a *truth claim*. The question at the end of every run is: **would I change a prompt because of this?**

## Three kinds of run

| Kind | What it's for | Rigor | Best evidence it can earn |
|---|---|---|---|
| **Baseline** | Characterize the room with nothing changed: how much a character varies across identical replays, and what the base rates are. | A written question and a fixed checkpoint. No prediction needed. | `observed` (as a number to beat later) |
| **Probe** | Try a change quickly and see if anything is there. | Prediction written first. Small n, reading the replies counts as evidence. | `observed` |
| **Test** | Decide whether a change is worth adopting. | Pre-registered prediction, primary measure and decision rule. Sized to detect the effect we care about. | `tested` / `refuted` |

A probe that looks exciting becomes a test. It doesn't become a finding ([[The Result That Prompts A Replication Overstates It]]).

## Always (not loosened)

1. **Prediction before data.** One or two sentences written before the first trial, saying what result supports it and what refutes it. The app enforces this for experiment records. For anything run outside an experiment record, write it in the ledger note first.
2. **A baseline before a comparison.** No test on a checkpoint and measure until we know how that measure behaves with nothing changed. Exp4 and Exp5 failed on this: the no-pile rate turned out to be 65%, not 53%.
3. **One change per condition.** Each condition differs from the control in one thing. If a change must touch two things, say so in the design and don't attribute the effect to either one.
4. **Compare only within a run window.** The provider drifts under byte-identical requests ([[Provider Behavior Drifts Under Identical Requests]]). Conditions being compared run concurrently, in one experiment. Numbers from different days are never pooled, and a comparison across days needs its own baseline rerun.
5. **Scope every result** to the model, provider, checkpoint, n and date.
6. **Evidence is never overwritten.** Corrections are appended with their date, both in the room and in the ledger.
7. **Deniz starts the spend.** Claude designs and proposes experiments, and states the call count and model. Paid trials run only on Deniz's explicit go-ahead. Test and scratch runs go to a throwaway data directory, never `.room-data/`.

## Loosened (for practical use)

- **No fixed significance threshold for probes.** A p-value is how often a gap this large would show up if the change did nothing. It's reported for tests, but the decision rule is written in practical terms: "adopt if the rate moves by at least X points".
- **State the effect size that matters, up front.** A small but real effect that wouldn't change how we write prompts is not worth sizing a test for. Size tests for the smallest effect we'd act on, not for the effect a probe happened to show.
- **Small n is fine for probes**, around 10–20 per condition. A big effect shows up at small n. A subtle one needs a test.
- **Qualitative reading counts,** with two guards:
  - write what you're looking for *before* reading (e.g. "disagrees with the claim, not just adds nuance");
  - read blind to the condition where feasible (shuffle the trials, hide the condition column), and only then look at which condition each reply came from.
- **Multiple measures are allowed.** Name one **primary** measure in advance. Anything else is exploratory and gets recorded as `observed` or `hypothesis`, not as the result.

## Measurement

- **Prefer an automatic outcome** (the experiment's outcome regex) when the thing measured has a surface form, like a vote or a named choice. Override it with manual labels where the regex misses. The extracted value stays visible.
- **For judgements** (tone, disagreement, style), write a labelling rule with examples of each label before labelling. The same rule is used across all conditions.
- **Always check reasoning length.** It's a hidden variable ([[Short Reasoning Joins The Pile]], [[Exp3 Reasoning Off]]). Compare the median completion tokens across conditions before interpreting a difference. If they differ a lot, report that alongside the result.
- **Mark specimens.** Replies that illustrate a finding get ☆ Favorite, so they can be reopened and exported later.

## Workflow

1. **Question.** One sentence. Which prompt decision would the answer inform?
2. **Checkpoint.** A fresh scene or an existing branch and revision. Record it.
3. **Baseline**, if this checkpoint and measure don't have one yet.
4. **Design.** Conditions (one change each), measured speaker, primary measure, outcome rule or labelling rule, n per condition, and the call count. When one design runs across several speakers, create one root experiment and **branch** it once per additional speaker, so they form a single family in the sidebar. Don't create them as independent experiments. (B1 was created independently and linked to its root afterwards.)
5. **Prediction and decision rule.** Written into the experiment record, which locks on the first run.
6. **Run.** On Deniz's go-ahead. Partial runs are valid, and deviations from the design are logged when they happen.
7. **Read.** Labels first (blind where feasible), then numbers, then reasoning length.
8. **Ledger.** One note in `experiments/`, plus updates to the `insight/` or `methods/` notes it touches, each at its correct evidence level. Add a line to [[Room Ledger]].
9. **Decide.** Adopt the prompt change, reject it, or escalate the probe to a test. Write the decision down.

## Ledger note template (`experiments/`)

```
---
type: experiment
date: YYYY-MM-DD
kind: baseline | probe | test
evidence: observed | tested | refuted
verdict: <one line>
room:
  experiments: <name id>
  base: <branch id> @ <revision id>
model: <provider / model>
---

## For future Claude        (one paragraph: why this ran)
## Question
## Prediction and decision rule   (copied verbatim from the locked record)
## Design                   (conditions, speaker, measure, n, run window, deviations)
## Results                  (table; median completion tokens per condition)
## Verdict                  (what stands, what doesn't, the decision taken)
## Related
```

## Related

- [[Room Ledger]] · [[The Result That Prompts A Replication Overstates It]] · [[Provider Behavior Drifts Under Identical Requests]] · [[Cached Input Makes Replays Cheap]]
- [[2026-09-24 Werewolf Experiment Series]]: the shakedown these rules came from.
