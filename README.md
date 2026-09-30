# room

a room with 8 AI characters (Boris, Ilya, Alexandra, Elorin, Jonas, Ceryn, Velric and Rook), the system prompts of which i have written myself. it runs locally on your computer as a web app: your conversations and records stay on your machine, and only the requests go out to the model provider you pick.

## the idea

these guys just have interesting conversations with each other. you are free to set the initial condition or do nothing and observe, although i wouldn't recommend observing for too long. give them a real purpose and put them to work. you don't need to say much, they are all purpose. you can also try to blend in as one of them and see if you pass the reverse Turing test. nothing tells them which participant is human, but in my experience, if they realise you're not AI they'll give all their attention to you, so be warned.

it's also a workshop. every reply is kept as evidence: the exact request, the raw response, the model's reasoning when the provider returns it. you can branch, rewrite history and run controlled experiments on how the characters behave.

## run it

Requires Node 22 and an [OpenGateway](https://opengateway.ai) API key.

```bash
npm install
echo "OPENGATEWAY_API_KEY=your_key" > .env
npm run workbench
```

Open http://127.0.0.1:4317. New rooms use `deepseek/deepseek-v4.1-flash-ultrafast` for every character; you can change provider and model per character. Together is also supported (`TOGETHER_API_KEY`). Keys stay in `.env` and are never entered in the browser.

Nothing generates until you press **Continue**. Every reply is a paid request, typically a fraction of a cent on the default model.

## what you can do

**Conversation**
- Pick who's in the room, who speaks next (or let it choose randomly), and run up to 20 turns at a time. **Stop** cancels.
- Join in under your own name. Characters only see you in the participant list once you've spoken.
- **Back-and-forth** alternates two characters automatically.
- Attach images and documents (PDF, Word, text, CSV, JSON) to messages.
- Edit each character's personality, memory, provider, model, temperature and reasoning (on/off) in **Characters**, plus the shared room instructions and the harness framing every request carries.

**Change history**
- **Branch** from now, or from any earlier message, with the prompts and memories as they were at that point.
- **Retcon** a message: rewrite or remove it, then regenerate from there or keep what followed.
- **Edit history** to insert, change, reorder or delete messages. Every edit becomes a new branch; nothing is overwritten.
- **Compare** two conversations side by side, as independent copies you can keep running.
- **Revise** a reply with feedback, accept or reject the alternatives, and export approved pairs as training data (JSONL).

**Look closer**
- **Inspect** any reply: the exact request sent, the raw response, the provider's reasoning, and how the speaker was chosen. Failed and rejected attempts are kept too.
- **Changes** shows what a branch changed since it split off, as a red/green diff.
- **Notebook** observations, and ★ Favorite / ✕ Dislike marks on replies. These are never shown to the characters.
- Optional **Jev** shadow observations, which record who a separate model would have picked to speak, without affecting the room.

**Experiments**
- Take a checkpoint, define conditions that each change one thing, write a prediction (it locks once trials start), and run many independent replays of the same turn.
- Results come as one table: outcomes per condition, reply text, reasoning, and token counts.
- Experiments run on their own copy of the conversation, can be branched to vary a design, and keep a lineage of how each one relates to the last.

## where things are

- [WORKBENCH.md](WORKBENCH.md): how every feature works, in detail.
- [prompt-knowledge/](prompt-knowledge/): the ledger. Experiment write-ups, findings, and the [ground rules for experiments](prompt-knowledge/experiment.md).
- [PRODUCT_SPEC.md](PRODUCT_SPEC.md), [EXPERIMENTS_SPEC.md](EXPERIMENTS_SPEC.md), [JEV_SPEC.md](JEV_SPEC.md): direction and design.
- `.room-data/`: your conversations and research records. Local only, never committed. Back it up yourself.

```bash
npm run test:workbench   # tests, no live API calls
npx tsc --noEmit         # typecheck
```

This project started from [letta-discord-bot-example](https://github.com/letta-ai/letta-discord-bot-example) (MIT licensed, see [LICENSE](LICENSE)). It used to run in Discord; the browser app has replaced that, and the old Discord code remains in `src/` unused.
