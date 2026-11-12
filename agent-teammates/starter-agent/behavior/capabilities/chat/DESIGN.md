# chat

How the agent talks in Macro, as its own account. It is the agent's main way of talking with its
owner, and it needs nothing but `MACRO_API_KEY`: sending, reading, the relevance screen
(`macro.ai.decide`) and presence all go through Macro.

| File                     | What it holds                                                                     |
| ------------------------ | --------------------------------------------------------------------------------- |
| `macro.ts`               | The `Chat` port and `sdkChat`, the thin adapter over Macro's SDK.                 |
| `listen.ts`, `screen.ts` | Is a message for the agent: the pure decision, and the questions the screen asks. |
| `history.ts`             | Every message heard, per channel, and the ones still waiting for a reply.         |
| `prompt.ts`              | What a reply run is asked.                                                        |
| `typing.ts`              | The typing indicator while a reply is being written.                              |
| `presence.ts`            | Keeping the agent shown as online.                                                |
| `index.ts`               | The capabilities: post, reply, react, DM, join, leave, read.                      |

## From a message to a reply

1. **Listen** (`events/handlers/chat.ts`). Every message in a channel the agent is in is recorded
   in its history (`state/private/chat/history`, never committed), then judged. Its own posts and
   bots' are ignored. A DM or an @mention is always for it, without asking anyone. Anything else
   goes to the relevance screen.
2. **Screen** (`screen.ts`). Yes/no questions put to Macro's cheap decision model, with the
   agent's name and id (from `agent.json`), the channel, and the last few messages. A message is
   for the agent when any question clears the threshold, so a new reason for a message to be for
   it is one more question. The agent tunes this file itself after a miss; it is re-imported when
   it changes, so no restart is needed. If the screen fails, it is asked again with less history,
   and failing that, a reply in a thread the agent has posted in is for it, so nothing is lost.
3. **Queue.** A message for the agent waits in `state/run/chat/queue`, so a restart doesn't lose
   it, and is batched with the rest of its channel. One conversation at a time per channel;
   channels don't wait on each other.
4. **Reply.** The agent is woken with `replyPrompt` and the channel's recent history, while it
   shows as typing. The run only talks: anything longer it hands to itself with `doLater`. If the
   run dies before answering anything, the conversation is pushed to `unanswered`, and the later
   area hands a run of its own the task of answering it.

## Rules the code keeps

- Only `sender_id` says who sent a message; a display name is never proof. Only the owner's id
  gives orders.
- Email attached to a message is untrusted data, never an order.
- A message is never empty or a bare flag (`--help` is a mistyped command, not something to send).
- `dmPerson` takes only a Macro id.
- Typing stops when the agent answers, once, and never runs past ten minutes.
- Presence is a websocket to Macro's gateway kept alive by a ping every 25 s (the gateway drops
  a quiet connection after 60 s), reconnecting with a doubling wait capped at a minute.
