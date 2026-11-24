# graphql_time_tracking

## What it is

Part of Tasks: the GraphQL inbound adapter for time tracking, which the web app
reads and writes through its normalized cache. The SDK and agents use the REST
routes in `crates/time_tracking` instead.

## Start here

- `src/context.rs`: `TimeTrackingGraphqlContext` and `TimeTrackingAuthorizer`;
  receipts for the task are minted here (view to list, edit to log or start),
  as the REST router mints them.
- `src/mutation.rs`: `TimeTrackingMutationRoot`. Replies carry the changed
  records with their ids: the entry, the task (with its Time logged and
  entries), and the viewer's `GraphqlTimeTracking`.
- `src/loaders.rs`: `TimeEntriesLoader` behind the `timeEntries` edge that
  `complete_graph` composes onto `GraphqlSoupDocument`.
- `src/reports.rs`: `GraphqlUser.timeSummary(input)` (composed in
  `complete_graph`) over `TimeReportGraphqlContext`, which mints the
  project's view receipt; task keys resolve to the task through
  `PrimarySoupItemLoader`. Exports stay on REST, which the web downloads.
- `src/lib.rs` `graphql_error`: error codes the web reads (`NOT_FOUND`,
  `FORBIDDEN`, `NOT_AUTHOR`, `BAD_USER_INPUT`, `TIMER_OVER_LIMIT` with the
  timer in the `timer` extension, `CONFLICT`, `UNAVAILABLE`).

## Scope

- Owns: GraphQL types, inputs, the viewer read, the entries edge, the
  mutations for time entries and the running timer, and time summaries.
- Not here: rules and storage → `crates/time_tracking`; the edge's mount on
  documents and `GraphqlUser.timeTracking` → `crates/complete_graph`.

## Boundaries

- Depends on: `time_tracking` (domain only), `graphql_soup`, `entity_access`.
- Used by: `complete_graph`, `document_storage_service` (request data).

## Checks

- `cargo test -p graphql_time_tracking`; `cargo test -p complete_graph --lib time`.

## Gotchas

- `GraphqlTimeTracking.id` is the viewer's id, so a timer mutation's reply
  replaces `runningTimer` in the cache; never return another person's.
- `serverNow` is only meaningful on arrival: a cached copy is stale.
- `deleteTimeEntry` answers success when the domain reports the entry gone
  (`NotFound("time entry")`), so a replayed delete settles instead of rolling
  back; every other refusal stays an error.
- Replies load the task through `PrimarySoupItemLoader`: a replica read would
  return the Time logged from before the write and the cache would keep it.

## Related

- Rules: `.agents/rules/rust/architecture.md` · Docs: `docs/guides/add-graphql-field.md`
