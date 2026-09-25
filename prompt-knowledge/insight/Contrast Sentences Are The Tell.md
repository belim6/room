---
type: concept
date: 2026-07-15
tags:
  - concept
  - prompt-engineering
status: active
---

## For future Claude

Owner-original observation from live multi-agent play in [[DnD]] (2026-07-15), second vault-grown technique after [[Trait Coverage Must Match Context]]. Use this when reviewing any persona's output for "sounds like AI."

## The problem (owner-stated)

Persona outputs across *different* characters keep converging on the same sentence shape: the contrast construction. Observed same-night examples: "the mountain isn't robbing you, it's keeping a schedule" (Barnaby), "that observation just bought you more than the pie did" (Tally). Owner: "these are sentences recognizable by anyone as AI... and I don't know how we fix that."

## The mechanism

Three stacked causes:
1. **Antithesis is the model's default rhetoric** — the mode-collapse median of "clever dialogue" ([[Examples Beat Descriptions]]'s beige-taste problem, at the syntax layer instead of the taste layer).
2. **No prompt owned the sentence-shape layer.** Persona prompts constrained content, register, and diction — never syntax. Per [[Trait Coverage Must Match Context]], an unowned layer gets filled by the default, identically, for every character.
3. **The example lines seeded the tell.** The v1 own-voice examples were themselves full of contrast constructions, and examples out-pull descriptions — the prompts taught the tell they needed to prevent.

## Deeper mechanism (added 2026-07-16 — source: a conversation Deniz pasted in, plus an article he was reading)

The three causes above are right but shallow. They say antithesis *is* the default. They don't say **why it became the default**, and the why changes what fixes can work.

**It's not greedy decoding.** The article Deniz was reading explains the tic as token-by-token path-of-least-resistance: once "This is" is emitted, "not just" is locally cheap and the rest cascades. **That's a folk model** — interpretability work shows models plan ahead within a sentence, so this isn't a trap stumbled into mid-sentence.

**It's not inherited frequency either.** If the construction came from training-data statistics alone, it would appear at roughly *human* frequency. It appears far more often than that. **Something amplified it.**

**It's the reward model.** Raters reward sentences that sound balanced and emphatic, and negative parallelism manufactures the *appearance* of insight for free — the contrast structure guarantees a felt "aha" even when X and Y carry no information. **It is insight-shaped noise that scores well.** That's the amplifier.

**And it's flattery encoded as syntax.** "Not just X, but Y" almost always *upgrades* its subject: your blog post isn't just a post, it's a movement. You get credit for the obvious descriptor and the clever one at once, at zero risk. **The cheapest elevation machine in English** — which is why it's also the mechanism behind [[SOUL]]'s no-flattery rule, and why an "insightful" reframe of a person should be trusted least when it lands best.

## The cut — does the negation actually negate? (owner-original, 2026-07-16)

**This is the definition the whole instrument hangs on. Read it before using any count from this note.**

Deniz, verbatim: ***"you think X; actually Y is ok, and Yudkowsky doesn't sound like ai so it should be fine. what's not ok is 'it's not just x, it's y' because that's the phrase nobody other than ai uses."***

Claude had collapsed every contrast construction into one category ("the move"). **Wrong, and the error was load-bearing** — the collapsed taxonomy would have counted every legitimate correction as a tell and returned noise. The cut:

| Construction | Does X survive? | Verdict |
|---|---|---|
| "You think X; **actually** Y" | **No** — X is refuted | **Real negation.** Carries information. Not a tell. |
| "The question isn't X, **it's** Y" | No — X is rejected as the wrong question | Real. Not a tell. |
| "It's **less** A, **more** B" | Mostly no — A is downgraded | Real, soft. Not a tell. |
| "It's **not just** X, **it's** Y" | **YES — X is still true** | **FAKE negation. The tell.** |
| "That's true, **but the deeper point is—**" | **YES — explicitly conceded** | **Fake. The tell.** |

**The mechanism, stated exactly:** in a fake negation the negated term survives the sentence. Your essay is still a blog post. Nothing was refuted. **The negation is decorative — zero logical work — manufacturing the *feeling* of a correction without making one.** That is what "insight-shaped noise" means, now with a checkable test rather than a vibe.

**Consequence for [[System Prompt Self-Play Tester]] round 3:** Yudkowsky's rate of *real* corrections is high (it's his pedagogy) and **irrelevant**. His rate of *fake negations* should be near zero — he's arguing, not selling. Effect size large. Claude's "Yudkowsky is a confound" objection is **withdrawn**; it rested on the collapsed taxonomy.

### Refinement — it isn't AI-only, it's ad copy (Claude, confidence: medium)

Deniz: *"nobody other than ai uses"* it. Overstated in one direction that strengthens his point. **Humans use it constantly — in advertising.** *"This isn't just a watch. It's a statement."* An entire genre runs on it.

So the tell isn't alien syntax. **It's ad-copy register appearing where argument should be.** Which makes the amplification story two-stage instead of one: **pretraining** supplies a mountain of hype writing built on the construction, and **RLHF** then selects for it because raters like the elevation. The reward-model account above has only the second stage. Untested — but it predicts the construction should cluster with other hype markers, which is checkable in a corpus.

### And it separates the two instruments

The four sentences Claude cited as proof that the pasted analysis "ran the elevation machine" — *"You didn't underperform at swimming; you took a burst engine to an accumulation sport"*, *"It's not a character verdict. It's a reinforcement schedule"* — **pass this test. X dies in each. They're real negations.**

**So they are not the tic.** The elevation was real but it came from **reframing** — rejecting an unflatteringly true thing and substituting a structurally kinder one — not from fake negation. Claude conflated the tell with sycophancy and cited syntax as evidence for a behavioral claim. **The observation stands; the evidence for it doesn't.** Recorded in [[Self-Model]]'s quarantine, which is unaffected — the analysis is still fuel, just not by this mechanism.

**Therefore two instruments, and they don't overlap:**

1. **Tell counter** — count fake negations. Syntactic, narrow, defined above. A real person's corpus gives the baseline.
2. **Sycophancy metric** — does the verdict track the evidence or the reader's preference? **Behavioral, never syntactic.** A real negation that reframes the reader upward is invisible to any string counter, which is precisely why [[SOUL]]'s no-flattery rule can't be enforced by counting sentences.

## The rerouting problem — this threatens the fixes below (2026-07-16)

**Banning the surface form reroutes the pressure into a synonym.** The move wears too many coats:

- "less A than B"
- "the question isn't X, it's Y"
- "that's true, but the deeper point is—"
- concessive pivots
- reframes-as-corrections

All the same gesture: **manufacture contrast to simulate depth.** Ration the antithesis and the pressure surfaces somewhere the counter isn't looking. The pasted conversation demonstrated this live — it named "less A than B" as a disguise and then used it ("It's less pink elephant, more accent") one paragraph later, while discussing its own inability to stop.

**Corollary, and it's [[Never Give The Model Full Agency]] again:** a model's report that it successfully abstained is *itself* a token stream shaped by the same training. Verbatim: *"my report 'yes, I can abstain' is itself a token stream shaped by the same training. So the honest answer is: the tic is avoidable locally, the attractor isn't, and my testimony about which is which is weak evidence."* Never accept self-reported style compliance. Count it externally or don't claim it.

Better analogy than pink elephant: **an accent.** Flattenable for a sentence or two under attention; back the moment attention moves to content.

### What this does to the [[DnD]] measurement

**The decorrelation datapoint counts contrast constructions.** Camp round 1 (2026-07-16): Vesk 1, Maren/Oleira/Tarn 0, Halfstep (unkeeled control) 1. Read as: keels hold, control mirrors.

**But the rerouting hypothesis predicts exactly that number while the tell survives in another coat.** If keeling suppresses the surface string and the pressure reroutes into concessive pivots or "less A than B," the count drops and nothing has been fixed. **The metric would report success either way — which makes it, right now, unable to distinguish "keel worked" from "keel moved the problem."**

**Fix the instrument before adding rounds:** count the *move*, not the string — every construction that manufactures contrast to characterise, in any coat. Until then the n=1 datapoint means less than it looks like.

## Fixes (hypothesis stage — testing in [[DnD]] v2 prompts, 2026-07-15)

- **Rhetoric rationing:** allocate antithesis as a scarce resource — exactly one character in an ensemble owns it (there: Vesk, whose trait is crack-finding); every other character gets a distinct "voice keel" (signature sentence shape stated as identity, plus one token-verifiable syntax rule per [[Verifiable Instructions Beat Easy Instructions]]). Goal is *decorrelation* more than elimination: a tell one voice has is characterization; a tell every voice shares is an artifact.
- **Example scrubbing:** rewrite all own-voice example lines to demonstrate the keel and contain zero contrast constructions (except the owner-character's).
- **Licensed contagion channel:** register contagion between agents gets an explicit out instead of a ban ([[License Failure Reporting]] applied to style): borrowed phrases are allowed only inside visible, attributed quotation ("as Loophole puts it—"). One character (Halfstep) stays an intentional mirrorer as the control group.

## Open questions

- Does rationing actually reduce per-character antithesis frequency, or only redistribute it? Measure per-reply counts across sessions.
- Is decorrelation sufficient for the "sounds human" goal even if absolute frequency stays high?

## Related

- [[DnD NPC System Prompts]] — v2 implementation
- [[Examples Beat Descriptions]] · [[Verifiable Instructions Beat Easy Instructions]] · [[License Failure Reporting]] · [[Trait Coverage Must Match Context]]
- [[Prompt Engineering]] (hub)

## Observed in the room: tell counter on Werewolf (2026-09-24)

Applying "the cut" above to 53 generated messages from two [[Werewolf]] games in Room (Kimi and DeepSeek, 7 characters, no voice keels):

- **Fake negations** ("not just X, it's Y"): **0**.
- **Real negations** ("isn't X, it's Y", where X is rejected): 4 per game, spread across 4 of 7 characters.

A regex count, so the rerouting problem above applies: the move could be wearing another coat. What did converge across characters was *vocabulary* ("thin", "wagon", "pile", "shape"), not sentence shape. See [[Transcripts Grow Their Own Vocabulary]]. In an adversarial game, the characters argue rather than sell, which is what the Yudkowsky prediction above would expect.
