# Programmatic calls

Status: phases 1 to 4 are built, except as listed below. Phase 5 (companions) is not.

Not built yet:

- Bot joins. Identities, attendance and orphan-room handling are in place, but the routes
  still refuse bot tokens: the `enable-programmatic-calls` flag is keyed on a user, and a
  team-scoped bot token has no acting user.
- Approved starts. An agent-attributed start is always refused; approval through
  `execution.reviews` is not wired.
- Reading other participants' registered work: it has no REST route.

Screen share has not been run end to end.

Goal: one supported way for a program to be a participant in a Macro call, able to do
everything a person can do there.

## The model

**Macro decides who may be in which call. LiveKit runs what happens in the room.**

The SDK does the Macro half and hands over a LiveKit connection. It does not wrap
LiveKit. LiveKit's own clients already cover audio, video, screen share, data and
subscriptions, and voice agents already build on them through `AgentSession`. A Macro
wrapper would have to chase all of that, and would get in the way of those tools.

```ts
import { Macro } from '@macro-inc/sdk';

const macro = new Macro();
const call = await macro.channels.byId(id).activeCall();
const connection = await call.join();
// connection.url, connection.token: use them with any LiveKit client
```

```ts
import { connectRoom } from '@macro-inc/sdk/calls/node';

const { room, connection } = await connectRoom(call); // a real @livekit/rtc-node Room
await session.start({ agent, room });                 // LiveKit AgentSession, unchanged
// ...
await connection.leave();
```

So there are two levels, and a program can use either:

| Level | Package | Returns | Runs in |
| --- | --- | --- | --- |
| Token | `@macro-inc/sdk` | `CallConnection`: URL, token, identity, room name | Anywhere except code mode |
| Room | `@macro-inc/sdk/calls/node` and `@macro-inc/sdk/calls/browser` | A LiveKit `Room`, already connected and with Macro's defaults | Node, Bun or a browser |

Keep room helpers out of the core entry point so ordinary SDK imports and the
code-mode bundle never load a media runtime. Optional peers avoid installing it
for callers that only use the core API.

## Why the current path isn't good enough

A voice agent built outside this repo already joins and talks in calls, using a Macro
user account, an API key and `@livekit/rtc-node` under Bun. It proves the approach, and
shows what is missing:

| What it has to do today | Why | What replaces it |
| --- | --- | --- |
| Cast into the SDK's private `client.storage` to reach routes listed as app-only | The SDK wraps none of them | `call.join()`, `channel.startCall()` |
| Check for a live call before every join | `GET /call/{channel_id}` starts a call and rings the channel if the last one just ended | `call.join()` can never create a call |
| Hold a local lock around every token request | A token request silently removes the user from their other call | `onOtherCall: 'fail'`, the default for SDK joins |
| Poll active calls and meetings every 3 seconds | Programs get no call events | Events, plus `macro.calls.active()` to reconcile |
| Merge calls and meetings into one list itself | Two routes, two shapes | `macro.calls.active()` |
| Run its own timers to leave an empty call | Nothing ends a call that only programs remain in | A server rule (below) |
| Call `getRingStatus`, which accepts only the LiveKit token from a VoIP push, with an API key | No other way to ask "is this ringing for me" | `call.ringState()` |
| Hold a separate room connection for the roster | Roster reads need a meeting token and exclude channel calls | `call.participants()` |

## Who a program is

| Principal | Identity in the room | Use | Phase |
| --- | --- | --- | --- |
| **Agent account** (`team.invite(..., { agent: true })`, `User.isAgent()`) with an API key | Its own user id | The recommended path: a long-lived program with its own name | 1 |
| A person's API key | That person's user id | Scripts acting as me while I'm not in the call | 1 |
| Meeting guest | A guest UUID | Standalone links, no account | 4 |
| Bot token | New `bot\|<uuid>` handling | Bots granted a channel. Refused today by `UserOrInternal` | 4 |
| Companion of a person | New `conn:<uuid>` | Sharing into a call while my own app stays in it | 5 |
| Code-mode program | None | Control methods only. It has a 30 second deadline and reaches only Macro hosts, so it can never hold media | - |

Agent accounts go first because they need no changes to attendance, access or identity
handling: to the backend they are already users. Programs must not use LiveKit's
`agent` participant kind, because the app's call view hides those participants,
including any screen share they publish.

A person's key has one trap: LiveKit allows one connection per identity, so joining
with my key disconnects my app. `join()` therefore returns `already_connected` when the
identity is in the room, unless the caller passes `replace: true`. Companions (phase 5)
are the real answer for that case.

## SDK surface

Follows the [SDK rule](../../.agents/rules/sdk.md): handles in and out, no raw ids.
`CallRecord` stays the one noun for a call.

```ts
// Find
macro.calls.active(): Promise<CallRecord[]>     // every live call I can see, either kind
channel.activeCall(): Promise<CallRecord | undefined>
call.kind                                       // 'channel' | 'standalone'
call.ringState(): Promise<'ringing' | 'answered' | 'declined' | 'ended'>
call.participants(): Promise<CallParticipant[]> // live, with track state

// Enter
channel.startCall(opts?): Promise<CallConnection> // joins if one is running; else rings and records
meeting.join(opts?): Promise<CallConnection>      // starts the room on first join
call.join(opts?): Promise<CallConnection>         // never creates; fails if the call ended
call.decline(): Promise<void>

interface JoinOptions {
  onOtherCall?: 'fail' | 'switch'; // default 'fail'; the app's behavior is 'switch'
  replace?: boolean;               // take over this identity's existing connection
  name?: string;                   // display name in the room
}

interface CallConnection {
  readonly call: CallRecord;
  readonly url: string;
  readonly token: string;          // omitted from toJSON
  readonly identity: string;
  readonly roomName: string;
  readonly started: boolean;       // whether this request created the call
  leave(): Promise<{ callEnded: boolean }>;
}
```

The call helpers add only what a program would otherwise get wrong:

```ts
connectRoom(target, opts?): Promise<{ room: Room; connection: CallConnection }>
publishScreen(room, source, opts?): Promise<ScreenShare> // screen-share source and encoding
```

`connectRoom` turns off Opus DTX the way the app does (`LivekitJsCallController.ts`: it
clips quiet speech after noise suppression), and calls `leave()` when the room closes.
`publishScreen` takes frames in Node (`VideoSource.captureFrame`) or a `MediaStream` in a
browser, with the browser picker as its default. Capture itself is up to the caller:
`rtc-node` has no capture engine, so a page screencast or `ffmpeg` output goes in as
frames.

The room helpers ship inside the SDK as separate `calls/node` and `calls/browser`
exports. The core entry point never imports them. Their build is separate from
core, and LiveKit runtimes are external optional peers, installed only by callers
that need media. Dynamic imports let browser applications load calls on demand.
There is one SDK version, package, and release workflow.

## Parity: everything a person can do

Status: **Exists** in the SDK; **Wrap**, the route exists; **New**, needs backend work;
**LiveKit**, use the room directly; **Client**, app-side behavior with no shared state.

| A person can | A program uses | Status |
| --- | --- | --- |
| See live calls | `macro.calls.active()` | Wrap |
| Be rung, and see it stop | `call.ringing`, `call.answered`, `call.declined` events, `call.ringState()` | New |
| Decline | `call.decline()` | Wrap |
| Start a channel call | `channel.startCall()` | New (`POST`) |
| Start an instant call | `macro.meetings.create()`, `meeting.join()` | Exists, Wrap |
| Schedule a call | `macro.calendar` | Exists |
| Join by link | `macro.meetings.lookup(token)`, `meeting.join()` | Exists, Wrap |
| Join as a guest | `meeting.joinAsGuest(name)` | Wrap, phase 4 |
| Leave | `connection.leave()` | New |
| Speak, mute, pick a microphone | `room.localParticipant`, `AudioSource` | LiveKit |
| Show video, pick a camera | `room.localParticipant`, `VideoSource` | LiveKit |
| Share a screen, with audio | `publishScreen()` | LiveKit plus helper |
| Hear and see others | Room subscriptions | LiveKit |
| See who is speaking, muted or on camera | Room events | LiveKit |
| See the roster without joining | `call.participants()` | New |
| Noise suppression, backgrounds | Same LiveKit processors in `/browser`; in Node, process your own frames | Client |
| Focus a tile, maximize a share | Not applicable | Client |
| Read and post in call chat | `call.timelinePage()` and `CallMessage` exist; add `call.discussion()` for the root post and channel-thread calls | Wrap |
| Rename | `call.rename()` | Exists |
| Set team sharing | `call.setTeamShare()` | Exists |
| Get a link | `call.meeting()`, `meeting.webUrl()` | Exists |
| Invite teammates to a standalone call | `meeting.inviteUsers()` | Exists |
| List and revoke links | `macro.meetings.list()`, `meeting.cancel()` | Exists |
| Register work, see others' work | `session.registerAsWork()`; add a read of others' work (GraphQL in the app) | Exists, New |
| Read the transcript and summary | `call.transcript`, `call.summary` | Exists |
| Download the recording | `call.recording.bytes()`, since code mode cannot reach the presigned URL | New |

No moderation: people have no mute-others, remove or end-for-everyone controls in a call
today, and programs should not get power people lack. If those arrive, they arrive in the
app and SDK together.

## Backend changes

All in `crates/comms/call`, in its hexagonal layout.

**Routes**

| Route | Purpose |
| --- | --- |
| `POST /call/{channel_id}` | The explicit start: the same get-or-create as the `GET`, but as a write, so code mode's dry run treats it as one. The `GET` stays for shipped clients; the SDK never calls it |
| `POST /call/record/{call_id}/join` | Join a live call, never create. Allowed for anyone who sees it in `active()`: channel members, and a standalone call's owner, attendees and invitees. View access alone is not enough, because team-shared viewers must not join. Returns `410` when ended, `409 in_other_call`, `409 already_connected` |
| `POST /call/record/{call_id}/leave` | Leave by call id, for one call only, so a stale program can't leave a newer call in the same channel. `decline` is bound to call id for the same reason |
| `GET /call/active/all` | Channel and standalone calls in one shape, each with its kind and whether it is ringing for the caller |
| `GET /call/record/{call_id}/ring` | Ring state for an authenticated user, reusing `get_ring_status`'s logic. The push-token route stays for native clients |
| `GET /call/record/{call_id}/participants` | Live roster from `list_participants`, with track state and whether each is a program. Same access as join |
| `GET /call/record/{call_id}/recording` | Recording bytes through a Macro host |

**Refuse tokens in code mode.** All token routes return `403` when the request carries
`x-macro-code-execution`. The sandbox cannot use a token, and it would land in the model's
context and the transcript. Tokens live 6 hours and cannot be revoked. `toJSON` on
`CallConnection` also omits the token, and it is never logged or put on a span.

**Mark programs in the room.** At join, the credential already says who is asking
(`CredentialOrigin`: `UserApiKey` and `MacroApiJwt` versus `Session`), and `is_agent` says
what the account is. Mint with a `macro.program` attribute (`with_attributes` exists in
the `livekit-api` crate) and store `client` on `call_participants`, with a default of
`person` per CS-70.

**A program must not hold a call open.** Today a call ends when its last participant
leaves, so a stuck program could keep a room and its recording running indefinitely. New
rule: when only programs have been in the call for 60 seconds, the existing
`finish_empty_call` path ends it. That covers people leaving, and a call a program started
that nobody answered within the 30 second ring. `stale_call_sweeper` is the backstop.

**Limit starts.** `channel.startCall()` rings people, so it takes a per-caller rate limit
through the existing `rate_limit` crate. An agent-attributed credential acting as a person
(`is_agent_run`) is refused unless approved through `execution.reviews`, as `email.send`
is. An agent account's own API key acts as itself, and is only rate limited.

**Events.** Add these to `WebhookEvent`, with access checks in fan-out and an SDK hydrator
(`src/events/hydrate/call.ts`), so `macro.events.on()` and `listen()` receive them:

- For everyone who can see the call: `call.started`, `call.ended`,
  `call.participant_joined`, `call.participant_left`, `call.recording_ready`,
  `call.summarized`.
- For one user: `call.ringing`, `call.answered`, `call.declined`, `call.invited`.

Today the per-user ones are hand-written JSON on the app's websocket and the others are an
internal broker topic. A program reconciles with `macro.calls.active()` when its stream
reconnects, so a missed event costs a delay and not a missed call.

## Client changes

Show an "Agent" badge on any participant with `macro.program` set, in the tile and in
Participants. People should know when a program is listening. Clients that haven't updated
show it as an ordinary participant, as they already do for these accounts today, so nothing
has to ship first. Being a participant, a program is recorded and transcribed like anyone
else, under the existing call notice.

The web app and native plugins do not move onto the call helpers. They share the routes and
the contract, not code.

## Observability

- Backend: `call.join` and `call.start` with `call.id`, principal kind, `call.client`, and
  outcome (`in_other_call`, `already_connected`, `ended`).
- `@macro-inc/sdk/calls`: `call.sdk.connect`, `call.sdk.publish_screen` (source kind,
  resolution, fps, outcome), `call.sdk.disconnected` (reason), sent through the SDK's
  existing observer, searchable by `call.id`.
- Never: tokens, display names, share links.

## Testing

- **SDK:** mocked tests for each method; `bun run coverage` with wrapped endpoints removed
  from `skipped.ts`; `bun run test` in `../sdk-docs` and `../code-mode-sdk`. Add
  `getBatchCallRecordPreview` to `postReads` if wrapped.
- **Rust:** service tests with port fakes for the join errors, the program-only end rule,
  and refusal in code mode; router tests for the access matrix, including team-shared
  viewers refused.
- **Dry run:** the operation catalog marks `POST /call/{channel_id}` as a write, and no SDK
  method calls the `GET`.
- **End to end:** on a local stack, a program joins with `connectRoom`, a second program
  speaks known audio, and each hears the other. For screen share, a Node program publishes
  known-color frames and a headless browser in the call asserts the pixels in its share
  tile. Then the last person leaves and the program's room closes.

## Delivery

| Phase | Ships | Result |
| --- | --- | --- |
| 1. Join | Routes above, `CallConnection`, `active()`, `ringState()`, `participants()`, `connectRoom` for Node, program marking and badge, the end rule | The existing voice agent drops its cast, its lock and its ring workaround. Calls and talking are supported |
| 2. Screen share | Spike, then `publishScreen` for Node and browser, `/browser` export | A program can share into a call |
| 3. Events | `call.*` events and hydrator | Polling goes away |
| 4. Remaining parity | `call.discussion()`, recording bytes, others' work, guests, bots | The parity table is complete |
| 5. Companions | `conn:` identities, so I can share from a script while my app stays in the call | Only if phase 2 shows people need it from their own identity |

The phase 2 spike comes first because video is the one unproven piece. `rtc-node` is proven
for audio under Bun, including its native-library needs on NixOS. Its docs show
`VideoSource` and `TrackSource.SOURCE_SCREENSHARE` but no complete screen-share example,
and we need to confirm the app renders one and whether Node has the screen-content mode
Python has (`is_screencast`), which affects text legibility.

Each phase updates `docs/agent-guide/calls.md`, `crates/comms/call/AGENTS.md` and
`packages/sdk/AGENTS.md`, adds a `@routing` sentence and `@agent` rules to the call
namespace, and releases through `release-sdk`. The optional room entry points are
documented in `packages/sdk/CALLS.md`. Connections sit behind a server flag so
they can be turned off without an SDK release.

## Decisions needed

1. **First principal.** Recommended: agent accounts, with a person's own key also working.
   Bots follow in phase 4. They add a new identity type to attendance, which is real work
   for little gain while agent accounts exist.
2. **Default when already in another call.** Recommended: `fail`, because a program that is
   silently moved out of a call is the bug programs hit today. The app keeps `switch`.
3. **Programs can't hold a call open.** Recommended: yes, with a 60 second total. The cost:
   two programs can't hold a call with each other. If that is wanted, make it an explicit
   option on the start.
4. **Agent badge.** Recommended: always shown. A program in a call can hear everything, so
   people should be able to tell.
5. **Screen share in code mode.** Recommended: not offered. An agent that needs it runs on
   a paired machine in a real process. A hosted share worker is a new service with its own
   cost and abuse surface, and should wait for a real need.

## Out of scope

- Moderation and recording controls, until the app has them.
- Mobile or native SDKs.
- Moving the web app or native plugins onto the call helpers.
- SIP or phone dial-in.
