# Full call support in the SDK

Status: proposed. Nothing here is implemented.

Goal: a program can do with a call whatever a person can do in the app: find it,
start it, join it, talk, show video, share a screen, see who is there, follow what
happens, and leave. The headline case is screen sharing from code.

## What exists today

The SDK covers calls after the fact, and scheduling. It cannot take part in one.

| Area | Today |
| --- | --- |
| Records | `CallRecord`: read, rename, delete, team share, speaker edits, messages |
| Meetings | `Meeting`: create, list, update, cancel, invite, link |
| Live call lifecycle | Routes exist, listed as app-only in `packages/sdk/src/coverage/skipped.ts`: `getOrCreateCall`, `leaveOrEndCall`, `checkActiveCall`, `getActiveCalls`, `declineCall`, `meetingJoin`, `meetingLeave`, `meetingParticipants` |
| Media | None. The only LiveKit client is the web app (`LivekitJsCallController.ts`, `CallContext.tsx`, `screen-share.ts`), bound to Solid state, and the native plugins |
| Events | `call.*` broker events exist (`crates/call/src/domain/events.rs`), but only internal consumers read them; none are in the public `WebhookEvent`, so `macro.events` cannot see a call |

## Constraints that shape the design

These come from the current code. Each one breaks the obvious design of wrapping
the existing routes and adding `livekit-client`.

1. **Media needs a long-lived process.** Code mode is a Deno child with a 30 second
   deadline, no timers, and network limited to Macro hosts
   (`crates/code_execution`). It can never hold a WebRTC session. The SDK core
   also runs in that bundle, so it cannot depend on a media library.
2. **A user can only hold one connection.** The RTC identity is the user id
   (`generate_token`), and LiveKit allows one connection per identity in a room. An
   SDK join with my API key disconnects my own app from the call I want to share
   into. `leave_or_end_call` also removes by user identity, so leaving from a script
   ends every device's participation.
3. **The join route is a `GET` with side effects.** `GET /call/{channel_id}` can
   create a call, start recording, dispatch the transcriber and ring the channel.
   Code mode's dry run treats every `GET` as a read
   (`packages/code-mode-sdk/scripts/generate.ts`), so wrapping it would let a dry
   run start a real call and ring people. `auto-rejoin.ts` already documents this
   route's hazard.
4. **Bots and harnesses are refused.** Every live route uses the `UserOrInternal`
   policy, which rejects `Bot` and `Harness` principals. Only users' API keys and
   JWTs get through.
5. **Tokens are bearer secrets.** RTC tokens live 6 hours and cannot be revoked
   (`crates/call/AGENTS.md`). `CallTokenResponse` returned from a code-mode program
   would land in the model's context and the session transcript.
6. **The room assumes two kinds of participant.** Webhooks handle a Macro user or a
   UUID guest and ignore anything else. The transcriber opens a session for every
   participant that connects, whatever its kind. The web call view hides
   `isAgent` participants, so a LiveKit agent-kind participant's screen share is
   never rendered.
7. **Roster reads don't cover channel calls.** Live participants are only readable
   through a meeting token, and carry only identity and name, with no track state.
8. **Presigned recording URLs don't work in code mode.** `recordingUrl` points at
   S3, which the sandbox cannot reach. `packages/sdk/AGENTS.md` forbids that as the
   only path to bytes.

## Design

### Two layers, two packages

| Layer | Package | Runs in | Contains |
| --- | --- | --- | --- |
| Control | `@macro-inc/sdk` | Everywhere, including code mode | Find, start, invite, roster, events, chat, records, moderation |
| Media | `@macro-inc/sdk-calls` (new), exports `/browser` and `/node` | A browser or a long-lived Node process | `connect()`, tracks, devices, screen share, data |

`@macro-inc/sdk-calls` has `livekit-client` and `@livekit/rtc-node` as optional peer
dependencies, so each consumer installs only its own runtime. This follows the SDK
guide's rule that runtime-specific bundles do not belong in the core package, and it
keeps the code-mode bundle free of media code.

Both exports implement one `CallSession` interface. They differ only in where media
comes from.

### Connections: the core new concept

A person's presence in a call and a program's connection to it become separate
things. A `member` connection is today's join, through `POST /call/{channel_id}` or
`meetingJoin`. A `companion` is new, minted by `POST /call/record/{call_id}/connections`:

| Field | `member` | `companion` (SDK default) |
| --- | --- | --- |
| RTC identity | The user id, as today | `conn:<uuid>`, new per connection |
| Effect on my app | Replaces my other connection | None; my app stays in the call |
| Attendance row, record access | Yes | No |
| Keeps the call alive | Yes | No; when the last person leaves, the room is deleted and the session ends |
| Requires | Channel membership or link | The same, plus a live call with at least one active participant |
| Grants | Publish, subscribe, data | What was asked for, enforced by `can_publish_sources`; default is screen and screen audio only, with no subscribe |

A companion carries LiveKit attributes `macro.kind = "companion"`,
`macro.owner = <user or bot id>`, and `macro.connection = <uuid>`, plus a display name
such as "Ann's demo".

Why this and not "let one identity have several connections": LiveKit does not allow
that, and companions need no schema change to `call_participants`.

### Control API

Follows the [SDK rule](../../.agents/rules/sdk.md): handles in and out, no raw ids.
`CallRecord` stays the one noun for a call, active or archived.

```ts
// Find
macro.calls.active(): Promise<CallRecord[]>             // channel and standalone
channel.activeCall(): Promise<CallRecord | undefined>
meeting.call                                            // exists

// Answer and invite
call.decline(): Promise<void>
call.meeting()                                          // exists; link for a live call
meeting.inviteUsers(users)                              // exists; rings

// Observe
call.participants(): Promise<CallParticipant[]>         // live roster with track state
call.discussion(): Promise<MessageThread>               // call chat or channel thread
macro.calls.summaries(calls)                            // batch preview
call.recording.bytes(): Promise<Uint8Array>             // through a Macro host

// Moderate (phase 5)
participant.mute('microphone' | 'camera' | 'screen')
participant.remove()
call.end()
call.recording.stop() / call.recording.start()
```

The control layer has no `startCall`. Starting adds the caller as an active participant
and rings the channel, so a start with nobody connected would ring people into an empty
call until the sweeper ends it. Starting belongs to `connect()`, which holds the media.

`CallParticipant` has `user` (or `guest`, `bot`), `kind`, `displayName`, `joinedAt`,
`tracks: { source, muted }[]`, and `ownedBy` for a companion.

### Media API

```ts
import { Macro } from '@macro-inc/sdk';
import { connect, screen } from '@macro-inc/sdk-calls/node';

const macro = new Macro();
const call = await macro.channels.byId(id).activeCall();

const session = await connect(call, { name: 'Release demo' });      // companion
const share = await session.screenShare.start(
  screen.fromPage(page, { fps: 15 }),
);
await share.stopped;
await session.leave();
```

```ts
import { connect } from '@macro-inc/sdk-calls/browser';

const session = await connect(channel, { as: 'member' }); // joins, or starts and rings
await session.screenShare.start({ audio: true }); // browser picker; needs a user gesture
await session.microphone.enable();
```

Full surface:

```ts
interface CallSession {
  readonly call: CallRecord;
  readonly state: 'connecting' | 'connected' | 'reconnecting' | 'ended';
  readonly participants: LiveParticipant[];
  readonly screenShare: { start(source?): Promise<ScreenShare>; current?: ScreenShare };
  readonly microphone: LocalMedia;   // enable, disable, setDevice, publish(source)
  readonly camera: LocalMedia;
  readonly data: { publish(payload, opts?); subscribe(topic, handler) };
  on(event: CallSessionEvent, handler): Unsubscribe;
  leave(): Promise<void>;
}
```

Events: `participantJoined`, `participantLeft`, `trackPublished`, `trackUnpublished`,
`trackSubscribed` (with frames or audio on Node), `activeSpeakers`, `connectionState`,
`ended` (with a reason: `left`, `removed`, `callEnded`, `network`).

`connect()` takes a `CallRecord`, or with `as: 'member'` a `Channel` or `Meeting`, which
start the call if none is running. A companion needs an existing `CallRecord`. Asking for
anything beyond the default is explicit:
`connect(call, { publish: ['microphone', 'screen'], subscribe: true })`.

### Screen sources

| Source | Runtime | How |
| --- | --- | --- |
| Default (picker) | Browser | `getDisplayMedia` |
| `screen.fromStream(mediaStream)` | Browser | Canvas, tab or generated capture |
| `screen.fromFrames(asyncIterable)` | Node | The caller supplies frames; the base every other Node source uses |
| `screen.fromPage(page)` | Node | Chromium page through CDP `Page.startScreencast` |
| `screen.fromFfmpeg(args)` | Node | Raw frames from `ffmpeg` stdout: files, or a desktop through `x11grab` / `avfoundation` / `gdigrab` |
| `screen.fromDesktop()` | Node | Wraps `fromFfmpeg` per platform; the OS prompt still applies, so macOS needs Screen Recording access |

The `rtc-node` package has no capture engine: it accepts frames through
`VideoSource.captureFrame`. That is why `fromFrames` is the base.

The macOS desktop app's picker (`desktop-screen-capture.ts`) is a Tauri command inside
the app. It is not reachable from the SDK.

### Backend changes

All in `crates/call`, in the hexagonal layout it already has.

| Route | Purpose |
| --- | --- |
| `POST /call/{channel_id}` | Same get-or-create as the `GET`, as a write. The `GET` stays for shipped native builds; the SDK never calls it |
| `POST /call/record/{call_id}/connections` | Mint a companion. Channel membership or `share_token`, never view access alone: a team-shared viewer must not be able to join |
| `DELETE /call/record/{call_id}/connections/{connection_id}` | End one companion without touching the owner's other devices. Members keep `leave_or_end_call` and `meetingLeave` |
| `GET /call/record/{call_id}/participants` | Live roster from `list_participants`, with attributes and tracks. Authorized by channel membership or attendance |
| `GET /call/record/{call_id}/recording` | Recording bytes through a Macro host |
| Moderation routes | Phase 5: `mute_published_track`, `remove_participant`, end, stop egress |

Other changes:

- **`CallRtcClient`:** add `generate_connection_token` (identity, attributes, source
  grants, TTL of 1 hour, not the 6 hours VoIP push needs).
- **Webhooks:** parse `conn:` identities into `CallWebhookEvent` as a third kind. They
  do not touch `call_participants` or `finish_empty_call`. `participant_joined` still
  goes through `orphan_rooms`, adding a `RoomParticipant::Connection` variant: today an
  unknown identity is ignored, and LiveKit recreates a deleted room on connect, so a
  stale companion token could otherwise sit in an orphan room.
- **Limits:** at most 4 connections per owner per call and 16 per call. Mint requests
  use the existing `rate_limit` crate.
- **Events:** add `call.started`, `call.ended`, `call.participant_joined`,
  `call.participant_left`, `call.recording_ready`, `call.summarized` to `WebhookEvent`,
  with access checks in the webhook fan-out, plus an SDK hydrator
  (`src/events/hydrate/call.ts`). `call.ringing` targets one user.
- **Live transcript:** `call.transcript_appended` on a per-call stream, not the broker
  topic. Batched on a timer per CS-48. Phase 3.
- **Transcriber:** skip participants with `macro.kind = companion` unless they publish
  a microphone, in which case attribute to the display name. Otherwise companions open
  unused STT sessions and screen audio may be transcribed as speech.

### Clients

- **Web** (`CallOverlay.tsx`, `CallParticipantsList.tsx`): render a companion as its
  screen-share tile only, labelled with its name, and list it in Participants under its
  owner with a "via SDK" tag. No separate camera tile unless it publishes a camera.
- **Native iOS and Android:** no change needed to ship. An old build shows a companion
  as a named participant with no video and shows its share if that build renders shares.
  Check both on a device. The server enables connections only after web ships.
- **Recording:** egress uses the `speaker` composite layout. Verify that a companion's
  share fills it the way a person's does.

The web app does not move onto `@macro-inc/sdk-calls` in this work. `CallContext.tsx`
holds many browser and lifecycle fixes, and moving it adds risk with no benefit to SDK
users. The two share the connection contract, not code. Revisit afterwards.

### Agents

| Program action | Rule |
| --- | --- |
| Read calls, roster, transcripts | Allowed |
| Join or use chat in a live call | Allowed |
| Start a call | Refused for an agent run, as `email.send` is, unless approved through `execution.reviews`. It rings a channel and starts recording |
| Get an RTC token from code mode | Refused on all three token routes when the request carries `x-macro-code-execution`: the sandbox cannot use one, and it would enter the transcript |
| Share a screen | An agent on a paired `macrod` runtime runs a Node script in its own process. `fromDesktop` there needs the operator's approval through the session's permission prompts |

Code-mode agents in the cloud get the control layer only until phase 6. They can already
create a meeting and hand people its link.

Add to `CallRecordNamespace`'s `@routing`: live calls, joining, and sharing, plus an
`@agent` block with the rules above. Open each new method's doc with the rule an agent
must follow, since the index shows only the first sentence.

### Security and privacy

- A connection's token never serializes: `toJSON` on the grant omits it, and it is
  never logged or set on a span.
- Every connection appears in the roster with its kind and owner. A program that can
  subscribe can record, so it must never be invisible; the `hidden` LiveKit grant is
  not used.
- The existing recording notice stays. A companion's screen and audio are part of the
  recording and transcript like anyone else's.
- Removing a person from a call removes their companions, and leaving as the owner of
  a member connection does not. A permission change that removes channel membership
  does not end a live connection today, for people either; that gap stays as it is.

### Observability

One trace from the program's action through the service. Mint adopts `traceparent`
through the normal layers, and each hop is searchable by `call.id` and
`call.connection.id`.

- Backend: `call.connection.mint` with `kind`, requested sources and outcome;
  webhook handling records the connection id.
- SDK: `call.sdk.connect`, `call.sdk.screen_share` (source kind, resolution, fps,
  outcome, error type), `call.sdk.reconnect`, sent through the SDK's existing observer.
- Never: tokens, display names, device labels, share links.

### Testing

- **SDK:** mocked tests per method (`packages/sdk/tests`), `bun run coverage` with the
  wrapped endpoints removed from `skipped.ts`, and `POST /call/record/preview` added to
  `postReads`. `bun run test` in `../sdk-docs` and `../code-mode-sdk`.
- **Rust:** service tests with port fakes for mint rules, webhook kinds, and orphan
  eviction; router tests for the access matrix, including team-shared viewers refused.
- **End to end:** on a local stack, a Node companion publishes known-colour frames, a
  headless browser in the same call asserts the pixels in its share tile, and the
  owner stays connected throughout. Then the last person leaves and the session gets
  `ended: callEnded`.
- **Dry run:** a test that the operation catalog marks `POST /call/{channel_id}` as a
  write and that no SDK method calls the `GET`.

## Delivery

First, a spike: publish from `@livekit/rtc-node` with `SOURCE_SCREENSHARE` under a
`conn:` identity into a local room and confirm the web app renders it. Its docs show
the `VideoSource` and `TrackSource` pieces but no complete Node screen-share example.
Also confirm whether Node exposes the screen-content mode Python has (`is_screencast`),
which matters for text legibility, and whether it runs under Bun.

| Phase | Ships | Depends on |
| --- | --- | --- |
| 1. Control | Active calls, `activeCall`, decline, roster, `discussion`, summaries, recording bytes, `call.*` events | Nothing |
| 2. Screen share | `POST` start, companions, web rendering, transcriber skip, `@macro-inc/sdk-calls` with `screenShare` in browser and Node | Spike, 1 |
| 3. Full media | Microphone, camera, subscribe, devices, data, active speakers, noise filter and backgrounds in the browser export, live transcript | 2 |
| 4. Other principals | Bots as companions (`UserOrBot` policy on mint, `BotAccessScope` for channel grants), meeting guests | 2 |
| 5. Moderation | Mute, remove, end, recording stop and start, plus matching app UI | Decision 3 |
| 6. Agents without a machine | Hosted share for code mode | Decision 4 |

Roll out connections behind a server flag (`enable-sdk-call-connections`) so it can be
turned off without an SDK release. Each phase updates `docs/agent-guide/calls.md`,
`crates/call/AGENTS.md`, and `packages/sdk/AGENTS.md`, and releases through
`release-sdk`. `@macro-inc/sdk-calls` gets its own `AGENTS.md`.

## Decisions needed

1. **Default connection kind.** Recommended: `companion`, so a script never kicks you
   out of your own call. `as: 'member'` is explicit. The cost is a second tile-like
   entry in the roster.
2. **Agents starting calls** (on a paired runtime; code mode cannot hold one). Recommended:
   refused unless reviewed, because starting rings people and records them.
3. **Who may moderate.** Today nobody can: there are no host controls, and participant
   controls are read-only in the app. Recommended: the call's creator, the meeting
   owner, and channel owners and admins, with the same controls added to the app so an
   SDK caller has no power a person lacks.
4. **Sharing from agents with no machine.** Recommended: paired `macrod` first, because
   it needs nothing new. A hosted worker (Chromium in a service, or LiveKit Ingress for
   URLs) is a new service with its own cost and abuse surface, and should wait for a
   real need.
5. **Metering.** LiveKit minutes and egress are real cost, and programs can run far
   longer than people. Recommended: no charge for now, but cap a companion at the call's
   life plus the connection limits above, and record usage per owner from phase 2.

## Out of scope

- Mobile or native SDKs: the packages target JavaScript runtimes.
- Migrating the web app or native plugins onto the new package.
- Waiting rooms, breakout rooms, and other features the app does not have.
- SIP or phone dial-in.
