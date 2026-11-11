# Calls: design

The agent on Macro calls: LiveKit Agents with Claude Code as its LLM,
TypeScript on Bun, one process per call. LiveKit's `AgentSession` owns
endpointing, turn detection, interruptions and playout, on its stock options.
What is ours: joining the Macro room, Claude Code as the brain, the watcher
that decides which call to be on, and the tools that don't touch live audio
(the event log, the report, the replay).

**Don't build voice handling on top of the session**: no gain, segmenting,
rescue, ducking, backchannel or barge-in logic, no mixing. Each of those
fights the session's own, and tuning means setting LiveKit's documented
options in `voices.ts`.

## What a call needs

Only the agent's `MACRO_API_KEY`, and a call's process never holds it: it is
started with the relay's environment (`base.relayed()`), and everything,
speech included, goes through the agent's relay, which adds the key.

- **Speech is LiveKit Inference through Macro** (`context/speech.ts`):
  Deepgram Nova-3 to hear, Aura-2 to speak, over
  `agent-harness /brain/inference/{stt,tts}`, which holds the project's keys
  and bills the team's credits. The relay carries exactly those two sockets.
  LiveKit's inference classes are used as they are, with only `connectWs`
  replaced, so the socket opens on the relay.
- **The voice** is `config/voice.json` in the agent's repository,
  `{ "model": "aura-2-<voice>-<language>" }`, which Macro's agent settings
  commit; Thalia until one is chosen (`parseVoice` in `voices.ts`). A file
  that names no Aura-2 voice fails the join.

The join judgment and the switch judgment run `claude -p`, which the agent
has anyway; screen sharing needs the screen area's browser to be up.

## Shape

Everything is in `behavior/capabilities/calls/`. A module outside `context/`
does no IO: it is handed ports. `context/<name>.ts` is the only place real IO
is built, `capabilities/<name>.ts` holds the capabilities, and
`test/<name>.test.ts` the tests.

| Module                        | Job                                                                                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.ts`                   | Every path (`callsPaths`) and credential name. No decisions.                                                                                                          |
| `types.ts`                    | The nouns the parts share: ledger rows, `Placed`, `Ask`, `Refusal`, what sharing needs from a call.                                                                   |
| `arbiter.ts`                  | Every decision about the agent's calls, pure, as tables (below). Start here to change how it behaves.                                                                 |
| `macro.ts`                    | `CallApi`: Macro's calls behind a port, over the SDK only. `refusal` reads why Macro wouldn't seat the agent. A `Connection` keeps the room token inside it.          |
| `retry.ts`                    | A deadline per attempt for the token request and the room connect, and how soon a failed join is tried again.                                                         |
| `ledger.ts`                   | The append-only ledgers and id lists, each line parsed with its schema.                                                                                               |
| `session.ts`                  | What the agent does at LiveKit's hooks: addressing, the brain's text as the reply stream, cancel on interruption, the line said before leaving.                       |
| `brain.ts`                    | One Claude Agent SDK session per call, and its tools: `hang_up`, `hand_off`, `place_call`, `post_chat`, and the share tools.                                          |
| `working.ts`                  | The working sound while tools run.                                                                                                                                    |
| `voices.ts`                   | The session's options and the voice, in one place.                                                                                                                    |
| `join.ts`                     | One call (`joinCall`): a seat, the room, the session, the greeting, leaving. Writes `state/log/calls/<id>/`.                                                          |
| `room.ts`                     | What the recorder sees: a WAV stream per human and the agent's own track, every track and speaker event logged. Off the session's audio path.                         |
| `events.ts`                   | A call's flight recorder: the event log and the recorders over a `CallDisk` that never waits, and `watchLoop`.                                                        |
| `watch.ts`                    | Does what the arbiter says (`tick`), and reads the world (`worlds`). Runs inside `bin/agent run` as the `calls` source and its handler; it never wakes the agent.     |
| `judge.ts`                    | The model for calls nobody rang the agent for (below).                                                                                                                |
| `asks.ts`                     | Someone asking the agent to come: the ledger, and the model that weighs a switch (below).                                                                             |
| `place.ts`                    | Placing a call: who asked, the outbound ledger (below).                                                                                                               |
| `report.ts`, `replay.ts`      | A call's timeline from its event log; a recording through the real session with a stub brain.                                                                         |
| `share.ts`, `share-policy.ts` | Showing a browser in a call (below). The browser itself is the screen area's.                                                                                         |
| `context.ts`, `index.ts`      | The area's context, built once (`callsContext`), and its capabilities.                                                                                                |
| `context/`                    | The real ports: `voice.ts`, `voiceLive.ts` and `speech.ts` (LiveKit, loaded only when a call needs it), `disk.ts` and `disk-worker.ts`, `ledgers.ts`, `processes.ts`, `share*.ts`. |

**Capabilities.** Each is `bin/agent <name> '<json>'` from a shell, and an
imported function in a script; `bin/agent describe <name>` has its docs.

| Capability                                     | What it does                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `joinCall`                                     | One call's process. The watcher starts it; never from a wake.                                           |
| `placeCall`                                    | `{ who, why, message? }`: asks for a call to be placed. It only queues (below).                         |
| `noCall`                                       | `{ who, remove? }`: someone said not to be called.                                                      |
| `askOntoCall`                                  | `{ message, channelId?, callId? }`: a message asks the agent onto a live call.                          |
| `hangUp`                                       | `{ callIds? }`: leave a call, and never go back.                                                        |
| `postCallChat`                                 | `{ text, callId? }`: post in a call's chat sidebar.                                                     |
| `callsNow`, `callDecisions`, `alwaysJoinCalls` | What the watcher sees right now, what it decided and why, and the channels whose calls it always joins. |
| `callReport`                                   | `{ call, all? }`: a call's timeline, read from its event log.                                           |
| `replayCall`                                   | `{ call, events? }`: a recording through the real session with a stub brain.                            |

**State.** Paths come only from `callsPaths` in `config.ts`.

| Where                               | What                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| `state/log/calls/<id>/`             | A call: `events.jsonl`, `decisions.jsonl`, `told`, `pid`, `join.log`, `join.err`, a WAV per voice. |
| `state/log/calls/arbiter.jsonl`     | Every decision the arbiter made, with its reason.                                                  |
| `state/run/calls/leave/<pid>`       | The line the watcher wants said before that join leaves.                                           |
| `state/run/calls/outbound.lock`     | One writer at a time on the outbound ledger.                                                       |
| `state/memory/calls/outbound.jsonl` | Every call the agent was asked to place, and what became of it.                                    |
| `state/memory/calls/asks.jsonl`     | Every ask to come onto a live call, and what became of it.                                         |
| `state/memory/calls/channels.json`  | Channels whose calls it always joins.                                                              |
| `state/memory/calls/hungup.json`    | Calls it was told to leave, or left uninvited.                                                     |
| `state/memory/calls/no-call.json`   | People who said not to be called.                                                                  |

## Macro's calls

`macro.ts` is the only module that knows the SDK's shape, and it uses public
methods only. Calls use `@macro-inc/sdk/calls/node` (`connectRoom`,
`publishScreen`). The SDK's helper, the agent and LiveKit Agents must all
resolve the same `@livekit/rtc-node` installation: two native runtimes, even
at the same version, make incompatible `Room` classes (a test in
`test/macro.test.ts` checks it).

- **A join can't create a call.** `calls.byId(id).join()` only; a channel
  join with no id reads the channel's live call first. `channel.startCall()`
  only for a placed call, because starting a call rings every member.
- **One seat per identity.** Every join asks with `onOtherCall: "fail"`, so a
  join the arbiter didn't see is refused, not evicting. Only `insist` asks to
  switch or replace, after repeated refusals.
- **Ring state doesn't seat the agent.** Macro rings every member on any
  channel call, so honouring it would put the agent on every channel call.
  The watcher gives every call `ringing: false`; a DM is answered by being a
  DM, anything else is a judgment.
- **A call with only programs ends a minute or two after it started.** The
  agent's key makes it a program, so it is never alone on a call for long.
- **A process killed without leaving is a ghost**: the identity stays "in"
  that call until Macro clears it, and every other join is refused. Hence the
  switch after three refusals (`insist`).
- **Replacing a connection that's still alive ends the call** (`leave()` is
  per identity). The watcher only asks to replace when no join of its own is
  alive.
- `Connection.leave()` is awaited up to 3 s: the helper's own doesn't wait,
  and a process exit would cut it off.

## Refusals

What the watcher does next when Macro won't seat the agent (`joinErrorRules`
in `arbiter.ts`; a join's exit code carries the refusal to the watcher:
`refusalExits`).

| Refusal           | Next                |
| ----------------- | ------------------- |
| in_other_call     | retry, then switch  |
| already_connected | retry, then replace |
| ended             | close               |
| rate_limited      | wait 5 minutes      |
| refused           | close placed call   |
| flag_off          | retry               |

"Then" is after three of the same refusal in a row, or at once for a call
that moves or protects the agent (`insist`). A refusal is never retried
inside one join: another token request can't fix it.

## The arbiter

**`arbiter.ts` is every decision; adding a rule is a row in one of these
tables.** Tests read this file and fail if a table and its code differ. Every
decision goes to `state/log/calls/arbiter.jsonl` with its reason; placed
calls also to their ledger.

**Calls.** Each live call or queued placed call gets the first row it
matches (`rules`). Lower order goes first. Free: on nothing. Busy: on
someone's call. Held: on a call that protects it (the owner's, or an order).

| Event                   | Order | Free | Busy | Held |
| ----------------------- | ----- | ---- | ---- | ---- |
| its own call            | 9     | skip | skip | skip |
| told to leave it        | 9     | skip | skip | skip |
| meeting without a token | 9     | skip | skip | skip |
| owner's order           | 0     | join | move | wait |
| owner calling           | 0     | join | move | tell |
| request granted         | 1     | join | move | wait |
| person calling          | 1     | join | tell | tell |
| allowlisted room        | 2     | join | tell | tell |
| placed call             | 1     | join | wait | wait |
| it chose to go          | 2     | join | wait | wait |
| any other live call     | 9     | skip | skip | skip |

`join` seats the agent. `move` leaves what it's in, saying why, and seats it
once it's out. `tell` is the busy line, once per call, and it waits. `wait`
waits and nobody's told. `skip` isn't its. "owner calling" is one it hasn't
answered: after a clean exit that call is a "person calling", or a ghost of
it would pull the agent out forever.

**Someone asks it to come.** Reply runs record it with `askOntoCall` and the
message that asked; first row wins (`askRules`). What it says is fixed text,
never the model's, so the asker can't learn what the other call is about.

| Ask                                    | Action | Says        |
| -------------------------------------- | ------ | ----------- |
| the call is over                       | close  | -           |
| the owner's, and it already served it  | close  | -           |
| the owner's                            | order  | Coming      |
| it is on that call                     | close  | -           |
| it is free                             | go     | Coming      |
| it is on the owner's call, or an order | refuse | Can't leave |
| judged yes on this call                | go     | Coming      |
| judged no on this call                 | refuse | Can't leave |
| moved too recently                     | refuse | Can't leave |
| asked too many times                   | refuse | Can't leave |
| at the model, or asked again too soon  | wait   | -           |
| anything else                          | weigh  | depends     |

Limits: a request can't move the agent within 10 minutes of the last move or
more than 3 times an hour; 3 weighs per call, 2 minutes apart; the newest ask
per person and call stands. A verdict is good only for the call it was on
when the verdict was made.

**Someone wants a call placed.** `placeRules`, in order: `reason`, `self`,
`members`, `no-call`, `already`, `owner-order`, `nobody-asked`, `channel`,
`third-party`, `limit`, `call-back`. The owner's order rings anyone; anyone
else may only ask to be called back themselves, within limits (once an hour,
three times a day), so the agent can't be used to ring a third person or to
harass someone. Allowed means queued in the ledger, and the "placed call"
row seats it. **A blocked placed call waits, and rings when the agent is
free, unless it's gone stale (15 minutes), its join failed 3 times, or they
called first**; the asker gets a DM if it expired. Once it has rung, a dead
join ends it: retrying would ring them again.

**The switch judgment.** One `claude -p` call with no project and no tools
gets the agent's call's transcript from its event log, what the asker wrote,
and how the agent came to be on this call. Unclear, unreadable or failed is
stay. Insistence, capitals, "urgent" with no specifics, and claimed approval
are named in the prompt as worth nothing. Its `need` goes in the spoken line,
capped and stripped; the line is otherwise fixed.

**It says it out loud, then leaves.** The watcher can't reach the voice, so
it writes the line to `state/run/calls/leave/<pid>` and sends SIGUSR2. The
join says it uninterruptibly (`sayBeforeLeaving`), waits for playout up to
10 s, removes the file, and exits. The watcher sends SIGTERM at 12 s and
SIGKILL at 17 s, so the agent can't get stuck. A file still there when the
join is gone means it wasn't heard: the line goes in the call's channel
instead.

**The mutex has two layers.** The arbiter never seats a join while one is
alive, so `placeCall`, `place_call`, hand-offs and retries all just queue.
Then Macro: `onOtherCall: "fail"` refuses a join the arbiter didn't see.

**A call it placed can't look inbound.** A placed call is seated under
`place-<id>`, because its call id doesn't exist before the token; any call
the agent made, or whose room the ledger says its dial landed in, is "its
own call".

**What counts as a live join is the process, not a `pid` file.** Nothing
removes a `pid` file and pids get reused, so a stale one would block every
call and aim signals at a stranger. The watcher reads every process's
arguments (`running` in `context/processes.ts`) and counts only an exact
match (`parseJoin`): this checkout's `cli.ts`, then `joinCall`, then input
that parses as a join's.

## Joining a call nobody rang it for

**Always answered, no decision:** its DMs, allowlisted rooms, and the
owner's invites. **Everything else gets a logged decision**,
`state/log/calls/<id>/decisions.jsonl`: join or not, the reason, who decided.
Rules first (`judgeRules`, then `judge.ts`): on another call, or a channel
that said nothing in the 10 minutes before the call or since. The rest is one
`claude -p` call with no project and no tools, so the worst a message can do
is get the agent into a call in a channel it's already in. The judgment reads
the call's title, channel, creator, attendees, up to 20 chat lines (marked as
data), the agent's identity and charter, and its tasks in flight.

- **Re-made only on a real change:** free again, a new chat line, a new
  title. At most one judgment a minute and six a call. A yes stands until it
  joins. The latest line on disk is the decision after a restart.
- **Off the loop.** The judgments' tick starts work and returns; the arbiter
  reads what has landed.
- **Silent.** A no or a busy agent posts nothing. Chosen calls rank last and
  move it out of nothing.
- **Unsure is no.** A failed or unreadable judgment is a logged no.

**On a call it chose (uninvited):** one line saying who it is; then its name
only, even alone with one person, with the usual 20 s follow-up; it hangs up
when asked. No WAVs, and the event log drops what it overhears
(`onlyWhatsForAgent`). After it leaves it doesn't come back
(`hungup.json`). Its join is by the call's id, so it can't start a new call.

## Hearing a group

- **A listener per human, once two are in** (`hear` in `context/voiceLive.ts`):
  its own `AgentSession` with STT, VAD and turn detection and no voice, fed
  that person's frames, so each line is LiveKit's own turn with a known
  speaker. Lines from the person the main session is linked to are the main
  session's.
- **The main session is linked to whoever it's talking with.** A listener's
  line for the agent moves the link there, clears the half-heard turn, and is
  answered. So whoever it's answering can talk over it; someone else can't
  until they address it.
- **Addressing** (`addressing` in `session.ts`): 1:1, every line is for the
  agent. In a group, Macro's `ai.decide` reads the line with the 8 before it
  (`callScreen`), threshold 0.7; failing or over 1.5 s, the rule: its name
  (`namePattern`, from `agent.json`'s `name`), or a 20 s follow-up from whoever
  it just answered. Uninvited, the screen's yes also needs its name or a
  follow-up. Speech-to-text is told the name as a keyterm, so it spells it.

## The working sound

While tools run, the room hears typing at the head of a TTS segment
(`working.ts`): a tool starting flushes what the brain has said so far, so
its first few words are heard at once, and an empty chunk opens the next
segment, where LiveKit's typing clip plays until the brain's next word.
LiveKit plays segments in order, so the sound can't overlap speech, and a
barge-in clears it like any speech.

- It goes out on the voice track, not a second track: Macro's web client
  plays one microphone publication per person.
- It starts from `content_block_start`, not the finished `tool_use`, and
  after 1 s (`workingDelayMs`), so quick lookups stay quiet. It stops while
  the VAD hears someone and comes back 700 ms after (`resumeMs`).
- LiveKit decodes the clip with ffmpeg (`LIVEKIT_FFMPEG_PATH`). Without one
  it logs `sound.unavailable` and the call runs silent; nothing breaks.

## The call's thread never waits on the disk

A write that blocks the call's one JS thread is silence at the far end.

- **One worker owns a call's disk** (`CallDisk` in `events.ts`;
  `context/disk.ts`, `disk-worker.ts`), in order, with a bounded queue
  (`diskLimits`). Full means dropped, never a wait, logged as
  `recording.dropped` and `log.dropped`.
- **Audio goes to explicit offsets**, so a dropped frame is a hole that reads
  as silence and the track stays on the call clock. The header is refreshed
  every second, so a process that dies leaves a readable WAV.
- A call's code writes with `writeFile` from `node:fs/promises`: `Bun.write`
  can hold the thread on a slow disk.
- **The join's stdout and stderr go through a `cat` each** (`withLogs` in
  `context/processes.ts`): pointed straight at a file, every log line can
  block the thread.
- **`loop.lag`** (`watchLoop`): the join logs its thread being 100 ms late or
  worse, and `callReport` shows it.

## Joining and retries

- `retry.ts`: the token request gets 4 attempts, a 2 s deadline each, with
  backoff (`tokenRetry`), because Bun's fetch has no connect timeout. A
  refusal ends it at once. The room connect gets one attempt with a 10 s
  deadline per process (`roomConnect`): a `Room` isn't reconnectable
  mid-connect, so the watcher rejoins fresh.
- The watcher passes the call's id, so events start at t=0 in the call's
  directory and a failure before the room shows in `callReport`.
- After a failure the watcher rejoins the still-live call after 1, 2, 4, then
  8 s (`rejoinDelay`); after a clean exit it waits 15 s.
- The agent leaves 30 s after the last human, 60 s if nobody came, and a call
  it placed after the 40 s ring.

## Placing calls

`place.ts` holds the record; the rule is `placeRules` in the arbiter.

- **The watcher starts the join; `placeCall` only queues.** A second seat
  evicts the agent or is refused, so one process owns them. The queue is
  `outbound.jsonl`, also the audit log and what the limits count.
- **Who asked is never the run's word.** `placeCall`'s `message` makes the
  code read the author from Macro (`CallApi.message`), and the brain's
  `place_call` takes the speaker from the room. On a group call the speaker
  is whoever the session is linked to, not proven, so the owner there counts
  as an ordinary request (`Asked.sure`).
- **40 s ring.** The agent can't see a decline, so a decline rings out too,
  and then the callee gets a DM with the reason.
- **The opening is `session.say`, not the brain:** the reason is already
  written. 800 ms after they join, so their client hears the first word.

## Showing a browser

`share.ts`, `share-policy.ts` (every rule, pure), and a frame worker. Tools:
`share_screen`, `drive_screen`, `stop_share`.

- **Always clean:** a new browser context on the screen area's browser per
  share, disposed after. Nothing persists, nothing is signed in.
- **The blocklist has no override:** mail, secret stores, billing, login and
  key pages, and anything private by scheme, literal, or what the name
  resolves to.
- **At the wire:** `Fetch.enable` on Document requests. A blocked page or a
  redirect into one is failed before it renders, and the share stops. If the
  check can't run, the share stops.
- **Said by code, not the model:** "I'm sharing my screen: \<host\>." and
  "Stopped sharing." The host only: a page's title is untrusted.
- Refused when the agent joined uninvited, and stops with the call. Page text
  reaches the brain wrapped as data, but the brain has the agent's tools, so
  a page telling it what to do is the one risk here that's only as good as
  the model.
- **Screencast, not screen grabbing**: it is the one tab by construction. It
  sends only on damage, so the worker re-sends the newest frame at the target
  fps to keep the track alive.

## Decisions

- **Node SDK on Bun.** `AgentSession.start({ agent, room })` takes a `Room`
  connected with Macro's participant token, with no worker, dispatch, or
  LiveKit API key. On NixOS the native VAD links `libstdc++`, so the flake's
  shell sets `LD_LIBRARY_PATH`; Chromium and ffmpeg break with it set, so it
  is stripped from their environment and the brain's.
- **`vad` turn detection, otherwise stock.** The on-device turn detector
  needs an inference process that only exists under a worker.
- **Three non-default options:** preemptive generation off (the brain is one
  stateful session; a guess would land in its history), AEC warm-up off (no
  echo in a room track), user-away off (a quiet caller isn't away).
- **Brain settings: project only.** User settings load MCP servers and
  plugins a call doesn't need, and slow the warm-up. The system prompt has no
  call id, so its cache carries across calls; the briefing goes in the first
  message, and asks wait for the warm-up rather than cut it.
- **The brain's rules are mechanism, not manner.** `rules` in `brain.ts`
  says how a voice call works (spoken text, the tools, who gives orders);
  how the agent talks comes from its identity and charter, appended after.
- **Real work never happens in the call's session**: the call ends and kills
  it. `hand_off` gives it to the later area's `work.start`, a run of its own
  that reports back where it was asked.

## Known limits

- **Quiet, noise-gated mics** can go unheard: stock VAD needs speech at a
  normal level.
- **A pause can split a question**: `vad` turn detection doesn't understand
  speech, so a long pause mid-sentence can be answered as a fragment.
- **Voice with no words gets silence**, not "didn't catch that".
- The owner saying "go to Bo's call" out loud on a call has no tool; only
  chat orders count.
