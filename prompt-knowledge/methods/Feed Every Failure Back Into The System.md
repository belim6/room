---
type: concept
date: 2026-07-16
tags:
  - concept
  - prompt-engineering
  - systems
status: active
confidence: stated - attributed to Karpathy by Deniz, primary source not captured
ai-first: true
---

## For future Claude

Dropped by Deniz 2026-07-16 as one of the two seeds for [[Prompting For Systems]]. Use this when setting up any long-running agent workflow, and especially when the same mistake happens twice.

## The method (owner-stated, verbatim, attributed to Karpathy)

> *"Karpathy's method is dead simple: write a spec before you start, maintain a scratchpad, and feed every failure back into the system permanently"*

**Confidence: stated.** Deniz attributes this to Karpathy; the primary source wasn't captured. **Find and link it before citing this anywhere outside the vault.**

Three legs:

1. **Spec before you start.** Decide what done looks like before the model starts producing. Without it you grade output against a target that drifts to match whatever came out.
2. **Scratchpad while you work.** External working memory, so state lives somewhere the model can re-read instead of somewhere it has to remember.
3. **Every failure back into the system, permanently.** Not fixed — *written down*, into the thing that runs next time.

## Why leg 3 is the one that matters

Legs 1 and 2 are hygiene; plenty of people do them. **Leg 3 is the only one that compounds**, and it's the one everyone skips, because fixing a failure *feels* like handling it. It isn't. A failure you fixed is a failure you'll meet again in a fresh context, because the fix lived in a conversation and the conversation ended. A failure you wrote back into the system is one the system can't repeat.

The word doing the work is **permanently**. Same distinction as [[Preloaded Context Taxes Every Turn]] from the other side: that note is about what you *stop* carrying every turn; this one is about the small set of things you must carry forever *because* they were paid for in failure.

## This vault is an implementation of leg 3

Worth being explicit, since it's the clearest example available:

- `_CLAUDE.md` **Section 0.5** ("Verify Live State Before Acting") is a failure written back permanently — it exists because speculation from stale context burned time once.
- The **Auto-Save** and **Propagation Rules** are specs (leg 1) for what must happen when.
- `Logs/` is the scratchpad (leg 2), and `Daily/` is its digest.
- [[Instructions To Disagree Become Dispositions]] and [[Contrast Sentences Are The Tell]] are both failures-turned-permanent: each began as something that went wrong and ended as a rule the next session inherits.

**The test of whether this vault works is whether leg 3 actually fires.** As of 2026-07-16 the honest scorecard is mixed: it caught the register-contagion failure and wrote it back within hours, but the same class of error — Claude reading vault silence as absence — happened **twice in one session** ([[Career]], then [[Persona Trait Compiler]]) before being written down. **Leg 3 only counts if it fires on the first repeat, not the third.**

## The tension worth watching

Leg 3 grows the system forever. [[Preloaded Context Taxes Every Turn]] says an always-loaded thing taxes every turn. **A permanent failure log is on a collision course with a token budget**, and nothing here resolves it yet. Candidate answers: failures get written back as *pointers* rather than prose; or they expire and get pruned (which `/obsidian-learn` claims to do); or only failures that recurred twice earn permanence. Untested — flag it when this vault gets big enough to hurt.

## Open questions

- Primary source for the Karpathy attribution — find it, link it.
- What's the pruning rule? "Permanently" and "small enough to preload" can't both be unconditional.
- Does a failure need to recur before it earns a permanent entry, or is once enough? Writing back every one-off may be how the tax gets out of hand.

## Related

- [[Prompting For Systems]] (hub)
- [[Preloaded Context Taxes Every Turn]] — the counterweight; read both together
- [[Instructions To Disagree Become Dispositions]] · [[Contrast Sentences Are The Tell]] — vault-grown instances of leg 3
- [[Career]] — where leg 3 conspicuously failed to fire the first time
