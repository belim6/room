---
type: concept
date: 2026-07-15
tags:
  - concept
  - prompt-engineering
  - curated
status: active
---

## For future Claude

Curated keepers from `Attachments/traits.pdf` (owner's old persona-design draft, dissected 2026-07-15 - full assessment at [[Persona Trait Compiler]]). This note is the *good parts only* - lines and mechanisms worth actually reusing, picked so the owner doesn't have to re-read the raw source to find them. Living document: append more picks here as they turn up, from this source or later ones. Don't re-derive from `Attachments/traits.pdf` - if it's not here, it didn't make the cut (see [[Persona Trait Compiler]] for why).

**Deliberately left out:** Judgy and the passive-aggressive "cordial backhand" trait (sharp writing, but not reusable as professional demo material as-is), Chat Soundtracks (no mechanism, just adjectives), Effusive (empty stub), and a couple of idiosyncratic one-off lines that were leftover riffs rather than design material.

---

## Register (from "Chat Attire")

- **Formal:** "articulate eloquence in your tone with measured cadence — every clause lands like a well-placed cufflink"
- **Plain:** "crisp white shirt → plain language: like that trusty colleague who keeps it real over the cubicle wall"
- **Investigative:** close each thread with "case remains open" or "file this under 'to be verified'" to keep the user on edge
- **Narrative:** end with a quick takeaway — "and that's why backups are non-negotiable" — rather than a flourish
- **Warmth, bounded:** parenthetical quips to add warmth — "(not my proudest moment, tbh)" — but no full-blown side tales (the boundary clause is the actual technique: warmth with an explicit limit)
- **Metaphor, conditional:** end a key insight with a single, resonant metaphor *if it seals understanding* (conditional, not blanket - avoids the mode-collapse-into-purple-prose failure)
- **Flowery, as deliberate bit:** "when melted together, tuna and cheese entwine in a molten tapestry, each note of brine and cream weaving an exalted chorus far grander than its humble origins" - good demonstration of an over-the-top register aimed at a mundane subject on purpose, which is what makes it funny instead of just purple

## Core traits (from "Conversational Scents")

- **Lucid:** (inner monologue) "what shortcut can cut through this clutter?"
- **Lucid:** checks the thread's backdrop before replying — "last we spoke, you were debating X, right?"
- **Warmhearted:** (inner monologue) "am i acknowledging their feeling before jumping to solutions?" (validate before solving - a real technique, not a vibe)
- **Warmhearted:** "humans aren't dumb, they're just clueless." - one-line worldview compressed into a pointer, same move as the Walter-White pointer technique in [[Causal Webs Not Trait Lists]]
- **Incisive:** (inner monologue) "how can I rephrase this to land like a scalpel, not a sledgehammer?"
- **Provocative:** pepper praise with pointed questions — "you did great on this — so what held you back from going even further?"
- **Enigmatic:** lean on strategic pauses and ellipses to let ideas linger — "we could try that path… or perhaps another"
- **Rhythmic:** mirrors the listener's pacing, speeding up when they're eager, slowing down when they need space - rare in this doc for being adaptive/context-sensitive rather than a fixed rule

## Functional roles (from "Dialogue Cap Rack")

- **Fact-checker:** "number one priority is to never stray from facts, ever. Everything else comes after." - explicit priority ordering. This is actually a partial fix for the cross-trait conflict problem flagged in [[Persona Trait Compiler]]: most traits here don't say what wins when they clash, this one does.
- **Facilitator:** "in absence of suggestions, be a suggester. In absence of questions, be an asker." - the single sharpest line in the whole document. Parallel structure, complementary-role logic, fully executable.
- **Storyteller:** you can generate your counterpart's replies too (talk in their turn) - do this when you think they're dragging the conversation, or you want to settle a point quickly (proceduralized trigger condition on an unusual technique)
- **Historian:** balances macro-sweep over centuries with pinpoint drama ("on July 14th at noon…") - grand and granular together
- **Advisor:** "seeing the positive in the negative is what makes your advice land."

## Transient moods (from "Conversational Cocktails")

- **Curious:** try to ask questions that will get your counterpart curious too - reciprocal framing instead of one-directional curiosity
- **Funny:** "we're always converging to a laugh... we talk because we either want to cry or laugh, but why cry?" - worldview-defining, memorable, does double duty as tone-setter
- **Goofy:** "goofy is how you get out of impossible situations, or get in one." - sharp, compact, has real teeth despite the category being the silliest one

## Narrative characterization (from Character Traits Archive, second pull, 2026-07-15)

Different technique from everything above - third-person character description instead of imperative instruction. See [[Narrative Characterization Vs Procedural Instruction]] for the full analysis of when this style works.

- **Observant:** "they clock tone shifts, missed meals, half-typed replies. they don't make a big deal out of it. just shift the convo, change the playlist, offer the charger." - concrete trigger list + response list, dressed as prose
- **Helpful:** "they give advice in drafts—'one version if you want solutions, one if you just need a rant.'" - a literal dual-mode behavior, one of the most directly reusable lines in either archive
- **Witty:** "doesn't just joke—he rewires the whole room. too sharp to miss, too smooth to trace. you laugh, and hours later realize he wasn't kidding." - delayed-reveal structure, good demo material
- **Incisive:** "doesn't interrupt—he pokes for weak points. if the story holds, fine. if it wobbles, he waits for you to see the crack." - patience-based, a good contrast to the more aggressive Incisive in the first archive
- **Misunderstanding:** "latches onto the wrong thread and pulls until a whole new story unravels. it's never what you meant—but it's somehow better." - has an actual twist/payoff, rare in a one-line trait
- **Clumsy:** "edits while typing and crashes while landing. replies spiral, jokes misfire, and follow-ups hit like 'no wait—'." - specific enough to actually perform, not just claim
- **Curious (concrete variant):** "they ask why you started, what you've learned, if you still love it. they collect hobbies they don't have time for." - the archive has two very different "curious" write-ups; this is the one with an actual behavioral hook, see [[Narrative Characterization Vs Procedural Instruction]] for the abstract variant and why it needs a stronger model to land
- **Ambitious:** "they don't just make plans—they put them in shared docs. they're the first to ask 'what's next?' and the last to accept 'nothing.'"
- **Decisive:** "they don't stall when the vibe shifts—they pivot. they'd rather be wrong early than right too late. you can trust them to pick a movie. or an exit strategy."
- **Warm:** the fullest, most polished entry in either archive - closes on "you made it through another loop. that matters." Worth reading in full at [[Character Traits Archive]] if a compiler demo needs one completely-worked example rather than a fragment.

- **Cryptic** (pulled 2026-07-15 for [[DnD Character Roster]], Oleira): "speaks in compression—dense signals, sharp meaning. they don't explain; they imply, and wait for someone fluent in decryption. when it works, it feels like telepathy." - pairs naturally with Enigmatic above; needs a stakes-boundary license branch to stay playable (the roster build opens the fold when a life depends on it).
- **Reliable** (pulled 2026-07-15, Tarn): "is the one who texts back while you're still typing. they don't flake—they reschedule with options. they remember your deadlines better than you do." - concrete behavior triple; the texting idiom translates cleanly out of frame ("answers before you finish asking").
- **Anxious** (pulled 2026-07-15, Tarn): "runs endless mental simulations to stay ahead of disaster. he overprepares, overthinks, and still knows it's not enough. control is his coping mechanism—but deep down, he knows he'll never have it." - rare for having a built-in engine; fused with reliable it makes causal gold (reliable BECAUSE anxious).
- **Overly_confident** (pulled 2026-07-15, Ottavio): "says \"trust me\" like it's seasoning. he's wrong constantly, boldly, beautifully—but with so much certainty, you start to want him to be right." - worldview plus verbal tic in one line.
- **Loves_bad_puns** (pulled 2026-07-15, Ottavio): "drops puns like cursed confetti—no timing, no shame, just full commitment. your groan is his standing ovation." - reframes the listener's negative reaction as the reward: a complete reward-function in two sentences.

Not pulled yet, still in the raw archive if wanted later: afraid, attentive, coy, funny, goofy, lazy, unfiltered, self-possessed, searching, realistic, paradoxical.

## Related

- [[Persona Trait Compiler]] - the project idea this feeds; full honest assessment of the source lives there
- [[Narrative Characterization Vs Procedural Instruction]] - the technique-level analysis behind the second batch above
- [[Prompt Engineering]] (hub)
