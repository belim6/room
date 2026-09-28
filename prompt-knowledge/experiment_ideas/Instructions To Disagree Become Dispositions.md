---
type: concept
date: 2026-07-16
tags:
  - concept
  - prompt-engineering
status: active
ai-first: true
---

## For future Claude

Owner-original observation, stated by Deniz on 2026-07-16 while specifying how Claude should push back on him — now operationalized as the pushback rule in [[SOUL]]. Use this whenever a prompt asks for a *conditional* behavior by naming a *disposition*: "be critical," "push back," "be skeptical," "be concise."

## The observation (owner-stated, verbatim)

> *"You should push really hard, but I have observed in the past when I tell a model this it causes a drop in general agreeableness, so only push back hard when you are sure you disagree."*

Deniz asks for hard disagreement **when the model is right to disagree**. What he got historically: less agreeableness *across the board* — disagreement with things the model didn't actually disagree with. The instruction was meant as a conditional. It executed as a character trait.

## The mechanism (confidence: medium — observation is Deniz's, mechanism is Claude's)

"Push back hard" names a **disposition**, not a **procedure**. A disposition has no per-response branch to attach to, so it lands as a global register shift instead of a rule that fires on a condition. **The conditional gets compiled into a trait.**

This is [[Proceduralize Instead Of Adjectives]] operating at the level of *interaction stance* rather than persona description, and it rhymes closely with [[Frequency Adverbs Are Unimplementable]]: just as "occasionally" has no counter across responses, "hard" has no threshold within one. Both ask the model to modulate along an axis it can only set globally.

The cost is that the disagreement goes **uninformative**. A model that contradicts everything carries no signal in any particular contradiction — the same degeneracy [[Never Give The Model Full Agency]] warns about, approached from the opposite side. A rubber stamp and a reflexive contrarian fail identically: both have decoupled the verdict from the evidence. Deniz's instinct to ration the pushback is therefore protecting its *information content*, not its politeness.

## The fix — gate intensity on a checkable condition

Deniz's own phrasing is already the fix: **"only push back hard when you are sure you disagree."** Confidence is the gate, and unlike "hard," it's something the model can genuinely evaluate per response ([[Verifiable Instructions Beat Easy Instructions]]).

General form (hypothesis): **never name the disposition, name the trigger.**

| Disposition-shaped (leaks globally) | Trigger-shaped (fires conditionally)                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| "Be critical"                       | "When you can name the specific failure, lead with it"                                        |
| "Push back hard"                    | "When you're sure you disagree, say so in the first sentence; when unsure, say you're unsure" |
| "Be concise"                        | "Cut any sentence that doesn't change what the reader does next"                              |

Pairs with [[License Failure Reporting]]: the conditional needs somewhere to land when it *doesn't* fire, so give the model an explicit out ("I'm not sure"). Without that licensed null branch, "only disagree when sure" decays back toward global disagreement — the model has no sanctioned way to say nothing.

## Open questions

- Does the trigger-shaped form actually decorrelate stance from topic, or merely relocate the leak? Testable in [[System Prompt Self-Play Tester]]: one persona, disposition-shaped vs trigger-shaped stance instruction, measure disagreement rate against claims the model demonstrably agrees with.
- Same mechanism as the unowned-layer effect in [[Contrast Sentences Are The Tell]] (a layer nobody constrained gets filled by the default), or a distinct one? If identical, these two notes may want merging under a general "unowned layers fill with defaults" concept.
- Deniz's observation comes from prior experience with unnamed models (confidence: stated). Does it reproduce on current ones, and at what instruction strength?

## Related

- [[Proceduralize Instead Of Adjectives]] · [[Frequency Adverbs Are Unimplementable]] · [[Verifiable Instructions Beat Easy Instructions]] · [[License Failure Reporting]] · [[Never Give The Model Full Agency]]
- [[SOUL]] — where this is operationalized as Claude's own behavior in this vault
- [[Prompt Engineering]] (hub)
