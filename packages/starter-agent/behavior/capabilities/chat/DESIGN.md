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
| `outgoing.ts`            | Advisory warnings about internal wording in posts, replies and DMs.              |
| `typing.ts`              | The typing indicator while a reply is being written.                              |
| `presence.ts`            | Keeping the agent shown as online.                                                |
| `online.ts`              | Telling Macro once per run that the agent is up (`POST /team_agents/me/online`).   |
| `index.ts`               | The capabilities: post, reply, react, DM, join, leave, read.                      |

## From a message to a reply

0. **Hear** (`macro.ts`, `incoming`). One live event stream. Macro doesn't replay a gap in it
   for long, so the stream keeps a cursor in `state/run/chat/stream-cursor.json`: the last event
   received, and an instant no later than the oldest message received but not yet recorded (the
   listener says when it has recorded one), so a restart with a backlog reads it again. After a
   restart it resumes from that event (the events service replays a short window, in one
   process), and every time the stream opens after a gap it also reads, from a minute before the
   cursor and at most a day back, the channels with activity since, each root's replies
   included. A cursor that can't be read reads the whole day. A catch-up waits a random 0–5 s first, so agents restarted together don't all read at once, and skips a root deleted in the gap. It skips only what the agent can't read (a 403 or 404: a channel, thread or message); any other failure, such as a backend still coming back, fails the pass, which is tried again from the channel that failed; a channel that fails 5 times is given up on and counted (`chat.catch_up.failed`), so it can't hold the cursor. Caught-up mentions and DMs up to a day old are answered like new ones (a shorter reply window is a follow-up). The cursor and the reply queue live in `state/run`, outside git, while history is in git-tracked `state/private`: a rollback rewinds history but not the cursor, so a message answered within the minute before the cursor can be judged, and answered, again. Bounds: 50 channels, DMs first,
   then the most recently active; 200 roots per channel, the newest kept, since a channel that
   busy is read for context more than for replies. A cap hit is counted on the
   `agent.chat.catch_up` span. A message seen twice is delivered once, and one already in
   history is not judged again. Caught-up messages are sorted within a channel only, and arrive
   after live ones that came in meanwhile, so history can hold a thread slightly out of order.
1. **Listen** (`events/handlers/chat.ts`). Every message in a channel the agent is in is recorded
   in its history (`state/private/chat/history`, committed with the agent's private state), then judged. Its own posts and
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
- The charter and reply prompt require plain descriptions of actions, never the agent's own
  tool, function, script or command names. Outgoing posts, replies and DMs (including calls
  and background notices using the shared chat port) warn in the `chat` log about SDK paths
  (`macro.email.inbox()`, never "Macro.", macro.com links or addresses), the agent's own
  function names (read from its catalog; camelCase only, so no everyday word), the code-mode
  tools, `bin/agent`, code-mode and runtime-package wording, and raw errors (HTTP 4xx/5xx,
  status codes, stack frames, a leading `Error:`). Only reason categories are recorded,
  never the message text. This heuristic is advisory: it neither rewrites nor blocks a reply,
  and a logging failure cannot prevent delivery. It does not inspect speech or arbitrary code
  that bypasses the chat port.
- `dmPerson` takes only a Macro id.
- Typing stops when the agent answers, once, and never runs past ten minutes.
- Presence is a websocket to Macro's gateway kept alive by a ping every 25 s (the gateway drops
  a quiet connection after 60 s), reconnecting with a doubling wait capped at a minute.
- When presence first opens, the agent reports itself online, retrying (a 404 too) until the server takes it.
  Until then its row reads Starting and its inviter hasn't been told it is ready.
