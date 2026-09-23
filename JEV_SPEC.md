# Jev integration — specification

Status: Draft for review · Version 0.1 · 22 September 2026
Companion to `PRODUCT_SPEC.md`. Section references (§) point there unless stated.

This document describes proposed integration, not implemented features. Figures
in §3 are measurements taken against the live API during the Discord prototype;
everything else is proposal. Provider capabilities and pricing must be
re-verified at implementation time.

## 1. Purpose and stance

Jev is TypeSafe's hosted "System One" model. It answers typed questions about
supplied state and returns calibrated probabilities rather than text.

**Jev enters this product as an observation instrument, not a controller.** It
runs on every turn, records what it would have decided, and decides nothing.
Promotion to actual control is earned by passing the evaluation in §7, per
capability, and is reversible.

This ordering is deliberate. A selector that acts cannot be measured against
what would otherwise have happened, and a room driven by an unevaluated selector
produces conversation data contaminated by that selector. Shadow-first keeps
both the evidence and the room clean.

Two uses are in scope:

1. **Speaker selection** — who speaks next.
2. **Turn-level judgements** — whether a turn needs external facts, whether a
   topic is exhausted, how eager each character is to speak.

A third use is implied by the first two and should be stated: Jev's per-turn
probability vectors are themselves research data about the room. Low confidence
is a finding about character distinctiveness, not only a routing failure.

## 2. What Jev is, and its hard constraints

These shape everything below and are not negotiable by implementation effort.

- **Stateless.** No session, no memory, no conversation. Every call is
  independent and sees only what is placed in `state`.
- **Not fine-tunable.** TypeSafe does not fine-tune or LoRA-adapt Jev with
  customer data; every account uses the same weights. "Training Jev" is
  unavailable in the literal sense. §6 covers what is available instead.
- **Two input channels only.** `state` carries facts; `instructions` per
  question carry intent. There is no system prompt.
- **`state` should be an object**, with named fields that instructions reference
  by name. A flat string blob measurably underperforms (§3).
- **Three primitives.** `choice` (pick one of up to 255 options, normalised to
  1), `score` (ordered descriptive levels), `noul` (independent yes/no
  probability, not normalised). Multiple questions in one request are evaluated
  independently and in parallel at near-zero added latency.
- **Not deterministic.** Repeated identical calls vary slightly (§3).

**Primitive selection is a modelling decision, not a style choice.** A `choice`
forces exactly one winner and normalises, so it expresses *relative fit* and
cannot express "everyone is eager" or "nobody is". Per-character eagerness is
therefore a set of independent `noul`s, not a `choice`.

## 3. Measured behaviour

Measured against `jev-1.13.0` on saved transcripts from the Discord prototype,
September 2026. Reproduce with `scripts/jevEval.ts`.

**Latency.** Single `choice`: 312–1269 ms across ~15 calls. Eight `noul`s in one
request: 370–1254 ms — confirming that added questions are near-free. One 4 s
timeout observed in live use, traced to a local network drop.

**Tokens.** A 20-turn state costs ~2,244 input tokens; an eight-question request
on the same state, 2,941 in / 162 out. Input dominates and is paid once per
request regardless of question count.

**Question framing dominates output quality.** Moving from a flat string state
plus one vague instruction, to object state plus explicit intent:

| transcript | before | after |
|---|---|---|
| `topicchange` | 0.16 – 0.34 | 0.61 – 0.63 |
| `antichrist_v2` | 0.85 – 0.92 | 0.93 – 0.94 |

The same rewrite moved the research `noul` on `antichrist_v2` from 0.72 to 0.31
— more conservative, and better targeted at the latest message.

**Jev reads the conversation; it does not apply fixed character favourites.**
Total variation distance between probability distributions:

- real transcript vs. same transcript with only the last line replaced: **0.72**
- real transcript vs. contentless filler: **0.87**

A prior-driven selector would score near 0. With contentless input Jev falls
back to a strong prior (Elorin 70%), which is a useful signature of "no signal".

**Stability is high and confidence is meaningful.** Five repeats per transcript:
argmax stable 5/5 in three of four cases and 4/5 in the fourth; distribution
drift ≤ 0.035; confidence ranges tight (0.93–0.94, 0.55–0.62, 0.12–0.16). The
unstable case sits at 0.14 confidence — instability where instability is
correct.

**Sharp distributions make sampling near-decorative at high confidence.** At
0.87 confidence, weighted sampling reproduced the argmax in ~89% of 1,000 draws.
Sampling does real work in the 0.4–0.6 band.

**Eagerness needs transcript-level questions, not disposition questions.**
Asking "does X want to speak?" produced spreads of 0.18–0.43 across characters —
too flat to select on. Asking instead about a checkable property of the
transcript that maps to each character's concern ("is there a proposal whose
costs nobody has tested?") produced spreads of 0.36–0.83 on the same inputs.

**Persistently low confidence is a finding, not a defect.** On several
transcripts confidence stays tightly at 0.12–0.16 under the improved framing.
The proposed reading: the characters are insufficiently distinct and the topics
are insufficiently tied to their concerns, so the room genuinely
underdetermines the next speaker. This interpretation is supported by, but not
proven by, the turn-distribution analysis in §8.

## 4. Role in the product

### 4.1 Shadow mode (default, all releases)

On every turn where a speaker is selected by any means, the backend issues one
Jev request and records the result **before** the turn is generated. The result
does not influence the turn.

- Shadow calls are visible in the inspector alongside the `GenerationAttempt`
  (§4.3 of the product spec) but are a separate record; they are not part of the
  model-facing context and must never enter a character's prompt.
- A failed or slow shadow call is recorded as failed and never blocks or delays
  the turn. Shadow latency must not be on the critical path.
- Shadow mode is disableable per room, and off entirely when no API key is set.

### 4.2 Advisory mode

Jev's ranking is displayed to the user when choosing a speaker manually — as a
suggestion with its confidence, not a default. The user's pick is recorded
alongside it. This is the primary label-generating mode (§6).

### 4.3 Control mode

Jev selects the speaker. Entered only per capability, only after §7 passes, and
always reversible to shadow. Control mode must be visibly indicated in the room
and recorded per turn, because it changes what the conversation data means.

### 4.4 Capabilities, promoted separately

| capability | primitive | proposed gate |
|---|---|---|
| speaker selection | `choice` | §7 |
| needs-research | `noul` | §7, lower stakes |
| topic exhausted | `noul` | not yet designed |
| per-character eagerness | `noul` ×N | §3 shows framing is not yet settled |

Nothing is promoted as a bundle.

## 5. Data model

Every Jev call produces one durable `JevDecision` record:

| field | contents |
|---|---|
| `id`, `at` | identity and timestamp |
| `branch`, `state_revision`, `turn_id` | what it was deciding about |
| `mode` | shadow \| advisory \| control |
| `request` | the exact JSON sent, including state and every instruction string |
| `instruction_version` | hash or version of the question set used |
| `response` | raw provider response, verbatim |
| `argmax`, `confidence`, `probabilities` | parsed selection output |
| `noul` answers | per question id |
| `chosen` | who actually spoke |
| `selection_method` | **forced \| locked \| random \| jev \| silence-breaker** |
| `latency_ms`, `usage`, `error` | operational |

**`selection_method` is load-bearing and must ship in Release 1.** Without it,
operator picks and random picks are indistinguishable in stored history, which
makes every later analysis and every training label worthless. This is not
hypothetical: the Discord prototype's 111 saved transcripts cannot be used for
evaluation for precisely this reason.

`instruction_version` is equally load-bearing: §3 shows question wording moves
confidence by more than 0.4, so decisions recorded under different wordings are
not comparable and must not be pooled.

Records are append-only research evidence under §5 of the product spec: an edit
to a room never rewrites them.

## 6. Improvement path

Fine-tuning is unavailable (§2). Four documented alternatives, in ascending
order of effort:

1. **Sharper criteria.** Per-character `what` / `not_for` / `examples` fields.
   TypeSafe's guidance: when a borderline case is wrong, the fix is usually a
   sharper boundary in the criteria. Character-confusion pairs from §7 tell you
   which boundaries to sharpen. Note the maintenance cost: criteria currently
   derive automatically from character prompts, and hand-written `not_for` text
   would not.
2. **Past decisions in state.** Include prior selections for this room as
   structured JSON. Bounded by the context-rot guidance: include only what the
   current question needs.
3. **Decompose and weight in code.** Multiple narrow questions combined with
   tunable weights — e.g. eagerness `noul`s combined with a selection `choice`.
   Adaptation lives in our code, not in the model.
4. **A model on top.** Use Jev's probability vector as features for a small
   classical model fitted on our labels. Language understanding stays in Jev;
   task-specific fitting becomes ours and *is* trainable. This is the only route
   that turns accumulated usage into a learned component.

**Threshold tuning on labelled examples is the closest available equivalent to
fine-tuning** and should be done first, since it is nearly free once §7 has
labels.

**Where labels come from.** Advisory mode (§4.2) generates one labelled example
per operator pick: Jev's full probability vector as input, the operator's choice
as target, the transcript as context. No separate labelling exercise is
required, and label volume grows with ordinary use. Labels from control-mode
turns are not independent and must be excluded from training and evaluation.

## 7. Evaluation and promotion

Implemented in `scripts/jevEval.ts`; to be carried into the product's experiment
framework (§4.8 of the product spec).

**Automatic, no human input:**

- **Sensitivity** — does the distribution move when the conversation changes?
  Compares real state against a swapped last line and against contentless
  filler. Current: 0.72 / 0.87 TVD. A drop toward 0 means Jev has stopped
  reading and is running on priors.
- **Stability** — repeated identical calls. Reports argmax agreement, confidence
  range, and distribution drift. Current: drift ≤ 0.035; instability confined to
  low-confidence cases.

**Requires the operator:**

- **Blind agreement** — the operator picks the next speaker at N conversation
  cut-points without seeing Jev's answer. Reports top-1 agreement, top-3
  agreement, mean rank, and per-confidence-bucket agreement.

**Promotion gate (proposed, to be calibrated on first real data):**

A capability moves from advisory to control when, on held-out cut-points:

1. Top-1 agreement is meaningfully above chance (12.5% at eight characters), and
2. **calibration holds** — high-confidence decisions agree substantially more
   often than low-confidence ones, and
3. sensitivity and stability remain within current bounds, and
4. the thresholds were fitted on data not used to evaluate them.

Criterion 2 matters more than criterion 1. A selector with mediocre agreement
that reliably knows when it is guessing is usable, because the gate can defer to
the operator. A selector with good average agreement and flat calibration is
not.

Evaluation uses held-out conversations, and where possible held-out characters,
consistent with §4.9 of the product spec.

## 8. Known open problems carried from the prototype

- **Silence-breaker cascade.** A confidence gate that triggers a topic change
  can feed itself: the change makes the transcript incoherent, which lowers
  confidence, which triggers another. Observed at 0.34 → 0.18 → 0.16 over three
  turns. Mitigated by better framing but not structurally prevented; a cooldown
  is the obvious fix.
- **The confidence gate measures the wrong thing.** Low confidence means a flat
  distribution — "anyone could speak" — not "the topic is exhausted". Silence
  should come from a dedicated question, not from the selector's uncertainty.
- **Turn concentration is real and unexplained.** Across 39 older transcripts,
  distribution over characters is significantly non-uniform (χ²=62.1, df=7);
  across 10 recent ones it is also non-uniform but with a *different* leader
  (χ²=22.1). Both predate Jev-driven selection. Candidate causes — operator
  forcing, restricted participant sets, or something else — cannot be separated
  without `selection_method`.
- **No pricing data.** TypeSafe publishes no pricing, rate-limit, or auth page.
  Shadow mode means one request per turn, always. Cost per session is unknown
  and must be measured before shadow mode is left on by default.

## 9. Release mapping

| product release | Jev scope |
|---|---|
| Release 1 | `JevDecision` record, `selection_method`, shadow mode, inspector display. No Jev-driven behaviour. |
| Release 2 | Advisory mode and label capture. Decisions survive branching and are branch-scoped; a branch inherits its parent's decisions as history, not as live state. |
| Release 3 | `jevEval` carried into the experiment framework; blind agreement as a standard comparison; threshold fitting on held-out data. |
| Release 4 | Model-on-top (§6.4) trained on accumulated labels; control mode for whichever capabilities pass §7. |

Acceptance for Release 1: every turn has a `JevDecision` whose recorded request
reproduces the call exactly; `selection_method` is correct for forced, locked
and random turns; a failed shadow call leaves the turn unaffected and is visibly
recorded as failed; no Jev output reaches any character's prompt.

## 10. Open decisions

- Shadow mode on by default, or opt-in per room? Depends on unknown per-call
  cost (§8).
- Does eagerness become a capability at all, or stay a research readout? §3
  suggests the framing is not yet good enough to select on.
- Should low Jev confidence be surfaced in the character workshop as a
  distinctiveness signal, given §3's reading? That would make Jev an instrument
  for the character work, not only for routing.
- Which classical model for §6.4, and does it live in the backend or in an
  offline script until it earns its place?
- Do we keep deriving `choice` criteria from character prompts automatically —
  which keeps them in sync but limits sharpening — or hand-author them and
  accept the drift risk?

No implementation, spend, or promotion to control mode is authorised by this
document alone.
