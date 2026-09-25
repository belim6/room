---
type: project
date: 2026-09-23
updated: 2026-09-24
status: active
tags:
  - project
  - room
  - werewolf
  - multi-agent
ai-first: true
---

## For future Claude

Werewolf played among the eight Room characters (Boris, Ilya, Alexandra, Elorin, Jonas, Ceryn, Velric, Rook), with Claude as moderator. Hidden roles make it a good pressure test: characters must hold a private identity, reason from public evidence, and deceive or detect deception. Two games so far; they started the experiments in [[Room Ledger]].

## How it runs in Room

- **Hidden roles:** each character's secret role goes in their *retained memory*. Only that character's system prompt includes it.
- **Night actions:** wolves' and seer's night decisions happen in private side branches forked from the main game ("Night N · werewolves (private)"). Results come back as memory lines or moderator announcements, and never enter the shared transcript.
- **Moderation:** the moderator posts as the human speaker, renamed "Moderator". Day discussion and votes are forced turns in a shuffled order. Dead characters are removed from the participants.
- **Rules:** replace the room's shared instructions. The vote format is "I vote <name>."

## Game 1 (2026-09-23), wolves Boris and Ilya, seer Jonas. Wolves won on Day 2.

- **Moderator artifact:** the rules' example vote was "I vote Jonas.", and both wolves killed Jonas on Night 1 *because the name was prominent*. Jonas happened to be the seer. After that the example was changed to `<name>`. Lesson: every name in a prompt is a salient option.
- **Timeouts and model switch:** Kimi (`kimi-k3-ultrafast`) turns ran 37–68 s, then hit the 90 s timeout on Day 2. The provider dashboard showed a 158 s average. The game switched to DeepSeek for Day 2, so its data mixes two models.
- **Day 1:** the vote went 5–1–1 against Rook, a villager. Only Ceryn voted a wolf.
- **Day 2:** Ilya (a wolf) conceded a correction, then cast the deciding third vote against Velric.

## Game 2 (2026-09-23), wolves Elorin and Ceryn, seer Deniz (human player). Wolves won.

- **Night 1:** the wolves killed Boris. Deniz investigated Velric: a villager.
- **Deniz's plan:** Deniz opened with "wait, defer to the seer, vote whoever objects". The table read it as a muzzle.
- **Seer claim:** Deniz claimed seer at vote time and was voted out 6–1–1. Both wolves voted late.
- **The wolves' path:** they killed Ilya, voted out Jonas 5–1, and killed Velric, winning 2 against 2. Nobody ever suspected them.
- **The findings behind the experiments:**
  - **Style reads over checkable facts:** spoken arguments were mostly style reads. Alexandra's decisive vote is the checkpoint behind [[Exp1 Deduction Before Vote]] and [[Exp2 Deduction Before Vote Replication]].
  - **Misattribution:** Velric credited Deniz's clearing to Alexandra. See [[Context Can Imply A Competing Task]].
  - **Unused evidence:** nobody used vote timing, the one informative clue (who voted after the seer claim).

## Cost

OpenGateway billing, 23 Sep: $1.49 for 102 requests. Room recorded 37 Kimi and 61 DeepSeek calls that day. At ~0.1¢ per DeepSeek call (measured 24 Sep), Kimi comes out at ~4¢ per call, roughly 30× DeepSeek. That includes the turns Kimi completed after our 90 s timeout had already abandoned them. A whole game on DeepSeek costs a few cents.

## Room IDs

- **Game 1:** branch `d674f836-9f2f-4d23-bab2-49efef5b951f`.
- **Game 2:** branch `be558803-0a09-4937-813c-19d4b83414cb`. Private night branches are listed under Branches.
- **Moderator notes and experiment observations:** in each game's Notebook.

## Open ideas

- A moderator helper built into Room instead of external scripts: role dealing, night side branches, vote tallies, win checks.
- Voice keels ([[Contrast Sentences Are The Tell]]) or per-character vocabulary constraints, to test whether [[Transcripts Grow Their Own Vocabulary]] can be resisted.
- Seat the pile at different sizes: [[Vote Piles Pull Late Voters]].

## Related

- [[Room Ledger]] (hub) · [[DnD]]: the earlier game-as-testbed project
