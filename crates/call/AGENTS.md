# call

## What it is

Part of Calls: Macro's video/audio call management (hexagonal), using
LiveKit as the RTC backend — call lifecycle, LiveKit rooms, recordings, and
in-call chat.

## Start here

- `src/domain/service.rs` + `src/domain/models.rs`: call lifecycle policy.
- `src/domain/service/guest_chat.rs`: active guest authorization for the shared
  call discussion; message storage and delivery belong to `messages`.
- `src/domain/meetings.rs`: scheduled-meeting ↔ call association (used by
  `calendar_events`/`calendar_scheduling` meeting links).
- `src/inbound/axum_router.rs`, `src/inbound/stale_call_sweeper.rs`: HTTP routes
  and the sweeper that ends abandoned calls.
- `src/outbound/livekit_rtc_client.rs`: LiveKit adapter.
- `src/outbound/pg_call_repo.rs`, `src/outbound/pg_voice_repo.rs`: Postgres.
- `src/outbound/ai_call_summarizer.rs`, `src/outbound/s3_recording_storage.rs`:
  call recording/summarization.

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
- Change ringing/decline behavior: `src/domain/service.rs` → `src/inbound/axum_router.rs`.
- Add an AI tool over calls: `src/inbound/toolset.rs` (feature `ai_tools`).

## Checks

- `cargo test -p call` (`SQLX_OFFLINE` unset).
- `just -f crates/call/justfile check` for an all-features compile check.

## Gotchas

- Declining a call on one device must stop ringing on every other device — this
  regressed once (#7092); route the decline through the shared call state, not
  a per-device signal.
- The team-memory helper only compiles with the `ports` feature (#7912) — don't
  reintroduce an unconditional dependency on it.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`
