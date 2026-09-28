---
type: concept
date: 2026-07-15
tags:
  - concept
  - prompt-engineering
status: active
---

## For future Claude

Two of the owner's old archives turn out to use opposite techniques for the same goal (defining an AI persona trait). This note names the split and gives an honest answer to the owner's specific claim - "these felt too abstract for models back then, but nowadays they could work" - about the second archive. Source: [[Character Traits Archive]] (verbatim), analyzed 2026-07-15.

## The two traditions, found in the owner's own archives

**Procedural** (`traits.pdf`, see [[Persona Trait Compiler]]): tells the model what to do. "-(inner monologue) 'what shortcut can cut through this clutter?'" Explicit, checkable, close to [[Proceduralize Instead Of Adjectives]].

**Narrative** ([[Character Traits Archive]], this pull): describes a person in the third person and expects the model to infer behavior from characterization. "she doesn't ease into a room—she warms it... she doesn't forgive mistakes because she's generous. she forgives them because she expects them." No instruction anywhere in that paragraph - it's pure character writing, and the model is trusted to derive a behavioral policy from it.

## Is the owner right that these needed a better model?

Partly, and it splits cleanly by entry, not by the archive as a whole:

**The concrete entries would have worked at any model tier**, because they smuggle an actual procedure inside the prose. `<observant>`: "they clock tone shifts, missed meals, half-typed replies... shift the convo, change the playlist, offer the charger" - that's a trigger list and a response list, just not formatted as one. `<helpful>`: "advice in drafts - one version if you want solutions, one if you just need a rant" is a literal dual-mode behavior. These aren't abstract, they're procedural instructions wearing a narrator's voice. A weak model probably executes these fine.

**The purely atmospheric entries are where the owner's claim actually holds.** `<searching>`: "doesn't chase answers—chases becoming. certainty feels like death. the search is the self." There is no behavioral hook in that sentence at all - a model has to build a theory of what a person like that *does* in a live conversation from philosophy alone, with nothing to fall back on if the inference is wrong. That's a real capability-gated task: it needs strong implicit character modeling, not just instruction-following. Weaker/older models plausibly either ignored this kind of prompt or produced a shallow restatement of the mood instead of behavior. Frontier models are noticeably better at this specific skill now. `<paradoxical>`, `<self-possessed>`, `<attentive>`, and the philosophical opening of `<curious>` ("wants fractures... what she's after isn't answers, it's friction") sit in the same bucket.

**Where I'd push back on "nowadays they could work":** capability closes the *inference* gap, not the *reliability* gap. [[Verifiable Instructions Beat Easy Instructions]] still applies regardless of model tier - nothing in "certainty feels like death, the search is the self" is checkable turn-to-turn, so even a model that nails the vibe once has nothing to re-verify against three replies later, and drift is likely over a long conversation. My honest read: for a single strong demo reply, the purely atmospheric entries will probably sing on a current model. For a persona that has to hold up over a long session, I'd still bet on the hybrid - narrative prose for flavor, at least one procedural/inner-monologue hook per trait for the check the model can run on itself. That's the same conclusion [[Examples Beat Descriptions]] points at from a different angle: description is the weak half of prompting on its own, better models just raise how far the weak half gets you before it needs the strong half's help.

## What's demo-relevant here

`<warm>` is the most complete example in either archive - it's the only entry with a payoff line ("you made it through another loop. that matters.") that a reader/model can actually reuse as a closing move, not just a vibe. That's worth pointing at directly if a compiler demo needs one fully-worked example instead of a fragment.

## Related

- [[Persona Trait Compiler]] - the project this feeds, now has two source traditions instead of one
- [[Persona Trait Library]] - curated picks, both archives
- [[Examples Beat Descriptions]]
- [[Verifiable Instructions Beat Easy Instructions]]
- [[Proceduralize Instead Of Adjectives]]
- [[Prompt Engineering]] (hub)
