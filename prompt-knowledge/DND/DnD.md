---
type: project
date: 2026-07-15
updated: 2026-07-15
status: active
tags:
  - project
  - roleplay
  - prompt-engineering
related-projects:
  - "[[System Prompt Self-Play Tester]]"
  - "[[Persona Trait Compiler]]"
ai-first: true
---

## For future Claude

Created 2026-07-15 at the owner's request — verbatim: "i think we need to start roleplaying. lets start a project dnd" — immediately after the [[System Prompt Self-Play Tester]] round-1 post-mortem conversation. The owner gave no further spec, so everything under "Inferred purpose" is inference from conversational context, not owner-stated. Resolve the session-zero questions with the owner before treating any inference as fact.

## Inferred purpose (confidence: medium — conversation flow, not owner-stated)

A D&D-style campaign is a context-generating machine: one session naturally cycles through negotiation, comfort, celebration, danger, gossip, and deception — exactly the varied-situation stress test [[Trait Coverage Must Match Context]] calls for, and a live venue for the round-2 probes specced in [[System Prompt Self-Play Tester]] (context-swap, coverage-vs-grain). Party members and NPCs could run on personas compiled from [[Persona Trait Library]], which would make the campaign a standing testbed for [[Persona Trait Compiler]] output. Counterweight, per `_CLAUDE.md`: this vault is also just the owner's home — the project may simply be for fun, and must not be force-fitted into the PE frame if the owner says otherwise.

## Key decisions (session zero, 2026-07-15, owner-stated)

- **Frame: both.** Played for real, but persona findings get harvested into the technique notes as they surface — the campaign doubles as the coverage stress test from [[Trait Coverage Must Match Context]].
- **Roles:** Claude DMs (world + NPCs); owner plays their own character.
- **Rules: rules-lite d20.** Real rolls when outcome is uncertain and stakes exist; DM sets DC (easy 8 / normal 12 / hard 16 / heroic 20). Dice are rolled with actual RNG (shell/python), never model-generated numbers — in the spirit of [[Never Give The Model Full Agency]], the DM doesn't get to invent its own luck.
- **Party: mix.** Key NPCs run on personas compiled from [[Persona Trait Library]] per the round-2 spec in [[System Prompt Self-Play Tester]] (proceduralized terminal values, license branches, own-voice examples); the rest built freely for the story.

**Evidence caveat for the feedback loop:** in-chat play means one model narrates every NPC in a shared context — no isolation, closer to "writing dialogue for both sides" than the tester's separate-call method. In-play persona observations are therefore *lower-confidence leads*, not findings: log them, but promote to a technique note only after a separate-call replication in [[System Prompt Self-Play Tester]]. (Isolation-grade NPC turns via separate agent calls are possible on request if a scene becomes a real experiment.)

## Player character — Bhelsim (owner-created, 2026-07-15)

**Concept (owner verbatim):** mind-shifting wizard — "like shapeshifting but for the mind"; interactions with sentient beings improve his range (owner's reference: the synthesizer in Blindspot). Meta-note for future Claude: this is the [[Persona Trait Compiler]] as a player character — he collects minds through conversation and runs them.

**Statline (adjectives proceduralized by DM per [[Proceduralize Instead Of Adjectives]], owner may correct):**
- Charismatic (+3): charm, persuade, read a room, make a stranger want to keep talking — the same exchanges that grow his mind-ledger.
- Adaptive (+3): operate inside an unfamiliar mind, role, custom, or crisis — become what the moment needs.
- Can't Walk a Line (-2, DM interpretation: no middle setting): any roll to stay neutral, hold back, split the difference, or keep a mind-shift partial; a held mind runs at full commitment until he shifts out.

**Wizard's Prerogative (owner-requested, 2026-07-16):** Bhelsim may exit any scene between beats and re-enter any later scene at a moment of his choosing — narrative teleport, genre-licensed. No in-fiction explanation owed. While absent, the table runs agent-only and the owner observes (extends the standing table preference); the party experiences him as simply gone.

**Mind-Shift ruling (DM):** Mind Ledger — every sentient being he's had a genuine back-and-forth with joins his range. Shifting is an action, d20: DC 16 brief acquaintance / 12 real conversation / 8 knows them well. On success he gains their manner, instincts, and competence-impressions — never their private memories or secrets. Signature table mechanic (proposed, pending owner approval): shifting into a compiled roster character hands the *player* that character's persona block to run — a human executing the system prompt, which doubles as a human-baseline test for the compiler.

## Tone (session zero addendum, 2026-07-15, owner-stated)

"Self-aware isekai middle world" — the party is genre-literate ("our characters have all seen the Lord of the Rings"), committing to the adventure the way adults at an 80s party play hopscotch: knowingly, with full commitment. DM ruling: **the world plays itself straight; only the party knows the genre.** Roster characters who join or orbit the party get a genre-awareness addendum in their agent prompt; the rest of the world stays earnest.

## Current status

2026-07-15 — **in play.** Opening scene: Ferrick's Landing muster — Tally Cooper is hiring a company to learn why the Grey Stair pass has swallowed three caravans (scene deliberately adjacent to her story hook). NPC mode confirmed by owner: key roster characters run as **persistent isolated agents** (fresh agent per character, continued via SendMessage so each keeps only its own memory; fed nothing but what it could perceive). Cast culled to 7 at owner's request (roster note has the split): active — Tally, Maren, Vesk, Oleira, Barnaby, Tarn, Halfstep; benched as world NPCs — Severin, Perrin (earmarked guild inquisitor), Vesper Lark, Riv, Cassia, Old Torv, Nolon, Ottavio.

**Table preference (owner, 2026-07-15):** the owner wants to *observe* NPC-agent-to-NPC-agent interaction more than be spotlit — DM should run agent↔agent exchanges in multi-turn stretches (relayed transcripts, isolation preserved) and only hand the scene to Bhelsim at genuine decision points. This doubles as live self-play testing.

**DM pacing rule (owner feedback, 2026-07-16, from fork):** persona-faithful agents generate persona-shaped play — Perrin's document-tier engine turned a simple errand into a fetch-quest loop, and the owner correctly called it ("drowning in paperwork"). No agent owns table fun; the DM must. Standing rules: (1) **Montage rule** — paperwork, provisioning, and A→B→A errands resolve off-screen in one narrated beat unless the player opts in; (2) gatekeeper-type personas get pointed at *dramatic* obstacles, never logistical ones; (3) remaining cast (Maren, Vesk, Oleira, Tarn, Halfstep) gets mustered via montage and introduced as v2 agents in the night-one camp scene. Next live scene on main: counting-house at dusk, manifest reveal.

## Persona observation leads (session 1, 2026-07-15 — isolation-grade unless noted)

- **First v2 decorrelation datapoint (2026-07-16, camp round 1):** contrast constructions across five simultaneous fresh spawns — Vesk 1 (her licensed budget, on the crack: "bell-less means safe, not just lucky"), Maren/Oleira/Tarn 0, **Halfstep (unkeeled control) 1** ("a cairn, not a road") — produced immediately after receiving Vesk's line in her scene block. Exactly the predicted signature: keeled characters hold, the control mirrors. n=1 round; measurement continues per [[Contrast Sentences Are The Tell]].

- **Register contagion between isolated agents:** Tally opened a reply with "Straight terms:" one turn after receiving Barnaby's format-constrained "Straight version:" line. She never saw his system prompt — only his words via relayed transcript — so this is the [[System Prompt Self-Play Tester]] round-1 register-anchoring lead reproducing under *real* isolation. n=1; watch for recurrence before promoting.
- **Flaw persistence without restatement:** Barnaby's "a joke is an oath" flaw fired twice unprompted across turns (pie-as-payment joke → self-recruited; then paid the whole pie instead of the offered half, citing the oath). Causal-web identity holding under multi-turn play.
- **Hooks surviving contact with a second persona:** Tally's cost-naming constraint fired in every turn of the Barnaby exchange, including while mirroring his register — unlike round 1, the trait wasn't eclipsed. Consistent with the round-2 spec fixes (proceduralized terminal values + token-verifiable constraints).

## Next steps

- Play the opening scene; log sessions to Dev Logs/ or a campaign log as they accumulate
- Owner to confirm or veto the mind-shift → persona-block handoff mechanic
- Harvest persona observations as *leads* per the evidence caveat above

## Related

- [[System Prompt Self-Play Tester]] — the experimental method this would extend from 4-turn dialogues to full scenes
- [[Persona Trait Compiler]] — the campaign as a standing demo/testbed for compiled personas
- [[Persona Trait Library]] — candidate party members and NPCs
- [[Trait Coverage Must Match Context]] — a campaign is the natural coverage stress test
