# calendar_scheduling

## What it is

Part of Calendar: personal and Macro-team booking pages — event types,
availability, collective/round-robin hosts, booking limits, and the booking
lifecycle. See `README.md` for the full product model and the required
MacroDB migrations.

## Start here

- `README.md`: integration requirements, booking semantics, and web entry points
  (`/app/book/:profile/:slug?`, `/app/booking/:id#token`) — read before changing behavior.
- `src/domain/service.rs`: authorization and booking policy (the crate's core).
- `src/domain/booking_links.rs` + `src/domain/booking_link_models.rs`: event-type
  and booking-link models.
- `src/domain/availability.rs`: weekly schedules, date overrides, and conflict
  resolution across connected calendars.
- `src/outbound/postgres.rs`: storage (feature `postgres`).
- `src/outbound/macro_services.rs`, `src/outbound/meeting_links.rs`: calendar/team
  domain ports and Macro-call meeting links (feature `calendar`).

## Scope

- Owns: booking links, event types, availability computation, and the booking/
  cancellation/reschedule lifecycle.
- Not here: the underlying `CalendarEvent` entity, sync, or team sharing →
  `crates/calendar_events`.

## Boundaries

- Depends on: `calendar_events`, `teams`, `email_validator`; optionally `call`
  via `calendar_events` (meeting links).
- Used by: `forms`, `ai_tools`.

## Recipes

- Add a booking policy rule: `src/domain/service.rs` → `src/domain/booking_links.rs`
  → `src/outbound/postgres.rs` → `src/inbound/router.rs` / `src/inbound/toolset.rs`.
- Change availability computation: `src/domain/availability.rs` → its callers in
  `src/domain/service.rs`.

## Checks

- `cargo test -p calendar_scheduling` (`SQLX_OFFLINE` unset).

## Gotchas

- Replacement availability uses the visitor's `timeZone` and local date; omitted zones and host administration keep schedule-date semantics.
- Booking range queries are half-open and capped at 733 days and 5,000 records;
  insights must treat a failed query as an error, never as an empty dataset.
- Existing bookings keep their original event/schedule snapshot after the
  booking link is edited or removed — don't resolve bookings through the live
  link config.
- Reschedule counts only increase after a successful move; old records default
  to zero rather than reconstructing unknown history.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`
