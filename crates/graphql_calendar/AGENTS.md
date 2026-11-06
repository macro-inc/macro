# graphql_calendar

## What it is

Backs the Calendar feature: the GraphQL inbound adapter exposing typed
calendar/event/occurrence objects, reads, mutations, and the authenticated
user's calendar query root.

## Start here

- `src/objects.rs`: the typed GraphQL objects (event time variants, attendee,
  reminders, out-of-office, sync status) — the richest part of the schema.
- `src/reads.rs` + `src/user_query.rs`: `CalendarGraphqlContext` and the
  user-facing query fields (occurrence ranges, changes/watermarks).
- `src/mutation.rs` + `src/inputs.rs`: typed mutation inputs/payloads with
  explicit error codes (see `bad_input`/`unavailable` in `src/lib.rs`).
- `src/writes.rs`: `CalendarGraphqlMutationContext`.

## Scope

- Owns: the GraphQL shape over calendar data.
- Not here: calendar domain logic and Google Calendar sync →
  `crates/calendar_events`, `crates/calendar_scheduling`.

## Boundaries

- Depends on: `calendar_events`, `graphql_common`.
- Used by: `complete_graph`, `document_storage_service`.

## Recipes

- Add a mutation: `src/inputs.rs` (input type) → `src/mutation.rs` (field +
  typed error codes) → `src/writes.rs` (context plumbing) → `calendar_events`
  if the domain operation doesn't exist yet.
- Add a read field: `src/objects.rs` → `src/reads.rs` / `src/user_query.rs`.

## Checks

- `cargo test -p graphql_calendar`.

## Related

- Rules: `.agents/rules/rust/architecture.md`
