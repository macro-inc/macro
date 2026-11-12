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
  `calendar_events`/`calendar_scheduling` meeting links).
- `src/domain/notification_events.rs`: public call event contract for
  access-checked webhook and stream subscribers.
- `src/inbound/axum_router.rs`, `src/inbound/stale_call_sweeper.rs`: HTTP routes
  and the sweeper that ends abandoned calls and deletes orphaned RTC rooms
  (`src/domain/service/orphan_rooms.rs`).
- `src/outbound/livekit_rtc_client.rs`: LiveKit adapter.
- `src/outbound/programmatic_calls.rs`: per-caller server flag for explicit
  start, join, and leave routes. The legacy GET flow remains available.
- `src/outbound/pg_call_repo.rs`, `src/outbound/pg_voice_repo.rs`: Postgres.
- `src/outbound/pg_call_repo/lifecycle.rs`: atomic empty and program-only
  archival checks; the latter uses the last human departure and a 60-second grace.
- `src/outbound/ai_call_summarizer.rs`, `src/outbound/s3_recording_storage.rs`:
  call recording/summarization.
- Recording downloads use the call record's view-access receipt and stream S3 chunks through `RecordingStorage`.

## Scope

- Owns: call creation/ringing/join lifecycle, LiveKit room management, call
  recordings, and persistent in-call chat.
- Not here: channel messages and threads outside calls → `crates/channels`;
  calendar meeting scheduling → `crates/calendar_events`, `crates/calendar_scheduling`.

## Boundaries

- Depends on: `channels` and `channel_change_db_utils` (feature `outbound`), `agent`/`ai_usage` (call summarization),
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

- A call's discussion is stored in `call_entities.discussion` when it is created, and can't be
  inferred from `channel_id`: past channel calls keep `call_chat`. See
  `docs/design/call-chat-in-channel.md`.
- Archive and delete channel-thread calls with `channel_change_db_utils`'s canonical call-root append as the final SQL statement, capturing the call's own channel and discussion before deletion triggers remove them.
- Acquire the shared channel message-write permit before the call write transaction; release the discovery lookup's connection before waiting, recheck the discussion in the transaction, and retain the permit through commit. Only typed admission failures become a safe retryable 503.
- Declining a call on one device must stop ringing on every other device — this
  regressed once (#7092); route the decline through the shared call state, not
  a per-device signal.
- The team-memory helper only compiles with the `ports` feature (#7912) — don't
  reintroduce an unconditional dependency on it.
- Treat DATE property literals as non-matches; apply ordinary boolean negation and keep non-date call filtering unchanged.
- RTC tokens live 6h and can't be revoked, and LiveKit recreates a deleted room
  when one connects. Only a room named after an archived `call_records` row is
  orphaned (call ids are never reused); meeting preparations and get-or-create
  candidate rooms have no `calls` row yet and must be left alone.
- Bot RTC identities use `bot|<uuid>`. Webhooks never write bot attendance or
  participant events; an archived call's recreated room evicts the bot.
- `enable-programmatic-calls` fails closed for the explicit start, join, and
  leave routes. Meeting join ignores optional join settings while disabled.
- Accept bodyless meeting joins even with `Content-Type: application/json`;
  shipped app clients send that header, while nonempty SDK bodies retain JSON validation and body limits.
- `GET /call/{channel_id}` remains the shipped get-or-create path. New callers
  start with `POST /call/{channel_id}` and join a specific live session with
  `POST /call/record/{call_id}/join`; the latter never creates a call.
- A view grant alone does not admit a user to a live call. Channel membership,
  standalone ownership, attendance, or an explicit invite is required.
- Every token-producing HTTP route refuses `x-macro-code-execution` because
  tokens can outlive a code execution and cannot be revoked.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`
