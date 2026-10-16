# calendar_events

## What it is

Part of Calendar: owns the stable `CalendarEvent` entity — parsing from
external sources (Google Calendar, Outlook, email invitations), mutation,
reminder dispatch, team availability, and provider/Postgres persistence.

## Start here

- `src/domain/models.rs` + `src/domain/events.rs`: the `CalendarEvent` entity and
  recurrence-occurrence projections.
- `src/domain/mutations.rs`, `src/domain/invitations.rs`, `src/domain/meeting_links.rs`:
  write paths — mutations, email invitations, and Macro-call meeting links.
- `src/domain/team_availability.rs` + `src/domain/team.rs`: team sharing/availability.
- `src/outbound/google.rs`, `src/outbound/pg.rs`: Google Calendar and Postgres adapters.
- `src/outbound/pg/outlook.rs`: durable Outlook synchronization; preserve
  provider-specific coverage on discovery.
- `src/inbound/dispatch_worker.rs` + `src/outbound/sqs_dispatch_queue.rs`: reminder
  dispatch queue (feature `dispatch`/`dispatch-sqs`).

## Scope

- Owns: the `CalendarEvent` entity, its Google/Outlook/email sources, recurrence
  occurrences, reminder dispatch, and team calendar sharing/availability.
- Not here: booking links, scheduling pages, and host/attendee booking policy →
  `crates/calendar_scheduling`; the calendar service's HTTP composition root →
  `services/calendar_service`.

## Boundaries

- Depends on: `call` (feature `call-meetings`, meeting links), `macro_user_id`,
  `notification` (feature `notify`), `model_notifications`, `aws-sdk-sqs`
  (feature `dispatch-sqs`).
- Used by: `email`, `ai_tools`, `channel_bots`, `graphql_calendar`, `complete_graph`,
  `calendar_scheduling`.

## Recipes

- Add a mutation: `src/domain/mutations.rs` → `src/outbound/pg.rs` (or
  `src/outbound/calendar_service_mutations.rs` for the HTTP client adapter) →
  `src/inbound/mutation_router.rs` / `src/inbound/toolset.rs`.
- Add a reminder type: `src/domain/reminder_dispatch.rs` → `src/inbound/dispatch_worker.rs`
  → `src/outbound/notification_notifier.rs`.
- Change team availability: `src/domain/team_availability.rs` → `src/outbound/pg_team.rs`
  → `src/inbound/team_router.rs` / `src/inbound/team_toolset.rs`.

## Checks

- `cargo test -p calendar_events` (`SQLX_OFFLINE` unset).

## Gotchas

- `CalendarEvent` is the stable Macro entity; external calendars and email
  invitations are sources feeding it, and recurrence instances are queryable
  occurrence projections, not separate events — don't model them as new entities.
- Imported point (non-recurring) events must survive sync and cache round-trips
  unchanged (#7762) — a regression here silently drops user events.
- Preserve the conservative OOO refresh hint on write outcomes and sync reports;
  its contract is in [team sharing](../../docs/design/calendar-team-sharing.md).

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`
