# calendar_event_id

## What it is

Shared type for Calendar: `CalendarEventId`, the id of a calendar event row
Macro stores, a `uuid_id!` newtype (CS-10).

## Boundaries

- Depends on: `id_newtype`; `sqlx` and `utoipa` behind the `sqlx` and
  `schema` features.
- Used by: `calendar_events` (occurrence, join-request and change services).

## Checks

- `cargo test -p calendar_event_id --all-features`

## Gotchas

- Not the provider's event id (Google/Outlook), which is a string.
- Not `scheduled_action`'s `EventId`, the id of a published Macro event.
