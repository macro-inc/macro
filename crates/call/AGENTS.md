# call

## What it is

Part of Calls: Macro's video/audio call management (hexagonal), using
LiveKit as the RTC backend — call lifecycle, LiveKit rooms, recordings, and
in-call chat.

## Start here

- `src/domain/service.rs` + `src/domain/models.rs`: call lifecycle policy.
- `src/domain/service.rs`: programmatic start/join policy, per-call leave,
  join access, and program-only expiry. Keep these decisions out of HTTP handlers.
- `src/domain/service/guest_chat.rs`: active guest authorization for the shared
  call discussion; message storage and delivery belong to `messages`.
- `src/domain/meetings.rs`: scheduled-meeting ↔ call association (used by
  `calendar_events`/`calendar_scheduling` meeting links), and
  `Meeting::resumes_call`: when a rejoin continues the meeting's ended call.
- `src/domain/models/sessions.rs`: a call record's RTC sessions
  (`CallRecordSession`); the first session's window is derived from the
  record's talk time.
- `src/domain/notification_events.rs`: public call event contract for
  access-checked webhook and stream subscribers.
- `src/inbound/axum_router.rs`, `src/inbound/stale_call_sweeper.rs`: HTTP routes
  and the sweeper that ends abandoned calls and deletes orphaned RTC rooms
  (`src/domain/service/orphan_rooms.rs`).
- `src/outbound/livekit_rtc_client.rs`: LiveKit adapter.
- `src/outbound/scheduled_call_resume.rs`: `enable-scheduled-call-resume`,
  read for the meeting's owner; always on in local stacks, and a service built
  without a gate never resumes.
- `src/outbound/programmatic_calls.rs`: per-caller server flag for explicit
  start and leave, and nonhuman join-by-ID requests. Human sessions can join
  existing calls by ID while the flag is disabled; legacy GET remains available.
- `src/outbound/pg_call_repo.rs`, `src/outbound/pg_voice_repo.rs`: Postgres.
- `src/outbound/pg_call_repo/call_list.rs` (+ `call_list/page.sql`,
  `call_list/people.sql`): the call list behind Soup's call views and CRM
  Calls tabs, read from the viewer's grants outward.
- `src/outbound/pg_call_repo/lifecycle.rs`: atomic empty and program-only
  archival checks; the latter uses the last human departure and a 60-second grace.
  Archival names the session's room, and a resumed meeting's later session
  merges into its record (`call_record_sessions`, summed talk time,
  transcript numbered on).
- `src/outbound/pg_call_repo/meetings.rs`: meeting joins allocate a session:
  join the live one, start a call, or resume the meeting's ended call in a new
  room (`MeetingCallAllocation`).
- `src/outbound/ai_call_summarizer.rs`, `src/outbound/s3_recording_storage.rs`:
  call recording/summarization.
- Recording downloads use the call record's view-access receipt and stream S3 chunks through `RecordingStorage`.

## Scope

- Owns: call creation/ringing/join lifecycle, LiveKit room management, call
  recordings, and persistent in-call chat.
- Not here: channel messages and threads outside calls → `crates/channels`;
  calendar meeting scheduling → `crates/calendar_events`, `crates/calendar_scheduling`.

## Boundaries

- Depends on: `channels` (feature `outbound`), `agent`/`ai_usage` (call summarization),
  `entity_access_db_utils`, `livekit-api`/`livekit-protocol`.
- Used by: `memory`, `ai_tools`, `models_soup`, `agent_trigger`, `crm`, `soup`,
  `calendar_events` (meeting links).

## Recipes

- Add a call event/activity: `src/domain/activity.rs` → `src/domain/events.rs`
  → `src/outbound/pg_call_repo.rs`.
- Add a public call notification: `src/domain/notification_events.rs` →
  `src/domain/service.rs` or its meeting/channel submodule → `crates/webhook`.
- Change ringing/decline behavior: `src/domain/service.rs` → `src/inbound/axum_router.rs`.
- Add an AI tool over calls: `src/inbound/toolset.rs` (feature `ai_tools`).

## Checks

- `cargo test -p call` (`SQLX_OFFLINE` unset).
- `just -f crates/call/justfile check` for an all-features compile check.

## Gotchas

- `GET /call/record/{id}` leaves out the presigned `recordingUrl` and `recordingPreviewUrl` for a program (`is_program_run`): they are bearer secrets for as long as they last. A program reads the bytes through `GET /call/record/{id}/recording` (`?session=N` for a later session; 0 is the first).
- `POST /call/record/{id}/link` refuses an agent's program or a bot (`refuse_program_link`, 403): a new meeting link lets anyone holding it join as a guest. Meeting responses still carry `shareToken`, because the SDK keys meetings on it and it grants only a guest join.
- A call's discussion is stored in `call_entities.discussion` when it is created, and can't be
  inferred from `channel_id`: past channel calls keep `call_chat`. See
  `docs/design/call-chat-in-channel.md`.
- A call id lives in exactly one of `calls`, `call_records`, or an imported
  `call_entities` row: archiving moves it in one transaction. The exception is
  a resumed scheduled meeting: while it is live again its id is in `calls`
  (the live session) and `call_records` (the earlier sessions), and the live
  row must win every read. A reader that checks `call_records` first shows a
  live call as ended. `call_entities.ended_at` keeps the previous end meanwhile.
- A scheduled meeting rejoined through its link before `scheduled_end`, after
  a call that ended inside its slot (from 15 minutes before
  `scheduled_start`), resumes that call: the same id in a new room, one
  history entry of several sessions. The empty room is still torn down; never
  keep one alive. Instant meetings, channel links, channel and DM calls never
  resume. A resume publishes the session's notifications but not a second
  `call.started`; each session's end publishes `call.record_archived`.
- The record's own room and media columns describe its first session; each
  later session is a `call_record_sessions` row keyed by its room. Late
  writers (recording attach, egress webhooks, transcript anchor, preview
  image) find their session by room or egress, never by call id alone.
  Deleting a record is refused (409) while its call is live again.
- Declining a call on one device must stop ringing on every other device — this
  regressed once (#7092); route the decline through the shared call state, not
  a per-device signal.
- The team-memory helper only compiles with the `ports` feature (#7912) — don't
  reintroduce an unconditional dependency on it.
- Treat DATE property literals as non-matches; apply ordinary boolean negation and keep non-date call filtering unchanged.
- RTC tokens live 6h and can't be revoked, and LiveKit recreates a deleted room
  when one connects. Only a room an archived session ran in, with no live
  session in it, is orphaned (`get_ended_session_call`): room names are never
  reused, and a call id goes live again only for a resumed scheduled meeting,
  in a new room. Meeting preparations and get-or-create candidate rooms have
  no `calls` row yet and must be left alone.
- Bot RTC identities use `bot|<uuid>`. Webhooks never write bot attendance or
  participant events; an archived call's recreated room evicts the bot.
- `enable-programmatic-calls` fails closed for explicit start and leave. For
  `POST /call/record/{call_id}/join`, only `MacroUserAuthentication::is_human_session()`
  bypasses the flag; API credentials remain gated. Programs are refused before
  the flag (see below), and the domain service still
  checks live-call admission and returns Gone for ended calls. Meeting join
  ignores optional join settings while disabled.
- Accept bodyless meeting joins even with `Content-Type: application/json`;
  shipped app clients send that header, while nonempty SDK bodies retain JSON validation and body limits.
- `GET /call/{channel_id}` remains the shipped get-or-create path. New callers
  start with `POST /call/{channel_id}` and join a specific live session with
  `POST /call/record/{call_id}/join`; the latter never creates a call.
- A view grant alone does not admit a user to a live call. Channel membership,
  standalone ownership, attendance, or an explicit invite is required.
- Every authenticated token-producing HTTP route refuses a program
  (`macro_authorization::is_program_run`: a credential signed for an agent or a
  routine run, or `x-macro-code-execution`), because tokens reach the model,
  outlive the run and cannot be revoked. A program can drop the header with a
  raw `fetch`, so the signed claims carry the refusal. The guest join has no
  credential and checks the header only.
- `edit_call_record_handler` refuses share permission and team sharing
  changes from a scoped agent session
  (`agent_correlation::context::refuse_sharing`, 403); a new sharing field
  joins that check.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`
