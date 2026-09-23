# Choosing participants

Restart the room with `npx tsx src/discord.ts` after updating the code.
Send these as ordinary text messages in the Discord room:

- `/participants` — show the current group and command help.
- `/participants boris elorin velric` — replace the group with these characters.
- `/participants boris, elorin, velric` — commas also work; names are case-insensitive.
- `/participants all` — bring everyone back.

At least one character must remain. Unknown names leave the current group unchanged.
Both random selection and Jev use this group, including Jev's random fallback and topic changes.
`#name` calls and `/toggle name` only work for participating characters.
Removing a locked character clears the lock. Removed characters' earlier messages remain in history.

The participant list is included in `/save name` and restored by `/load name`.
Loading a save made before this feature restores everyone. `/reset` clears the conversation but keeps the selected group.

Offline regression check (Node 22.13+): `node tests/participants.test.cjs`.
