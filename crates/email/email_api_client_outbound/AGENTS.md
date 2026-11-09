# email_api_client_outbound

## What it is

Part of the Email feature: the Gmail and Outlook (Microsoft Graph) adapters
for the ports in `crates/email/email_api_client_core`, and the Redis
admission gate every Graph request passes.

## Start here

- `src/gmail.rs`: the Gmail adapter (feature `outbound-gmail`).
- `src/outlook.rs`: the Microsoft Graph adapter (feature
  `outbound-outlook`); every Graph call goes through `outlook/transport.rs`,
  which owns request headers, provider error mapping, write-failure logs,
  and one `outlook.graph_request` span per attempt (with an
  `outlook.graph_admission` child for the per-mailbox gate wait).
- `src/microsoft_gate.rs`: the Redis admission every Graph request
  passes (window, concurrency, cooldown), which also counts admitted requests
  per sync generation.

## Scope

- Owns: provider wire models, requests, conversion and error mapping.
- Not here: provider-neutral models, ports and orchestration →
  `crates/email/email_api_client_core`.

## Boundaries

- Depends on: `email_api_client_core`, `email_utils`, `email_types`,
  `gmail_client` (feature `outbound-gmail`), `calendar_events` (feature
  `outbound-outlook`).
- Used by: the composition roots `services/email_service` and
  `services/calendar_service` only, so an adapter edit rebuilds only them.

## Checks

- `cargo test -p email_api_client_outbound --all-features`. The Outlook
  calendar mutation tests in `src/outlook/calendar/test/mutations.rs` drive
  the calendar domain service against Postgres through `#[sqlx::test]`, so
  they need the local test database from
  [Database development](../../../docs/development/database.md).

## Gotchas

- 
- Graph answers a bodyless POST or PATCH without `Content-Length: 0` with 411
  Length Required. `transport.rs` adds the header, so new Graph calls must go
  through `request`/`conditional_request` rather than the raw client. Use
  `graph_request` only when a caller must branch on the Graph status, error
  code, or request id; the others drop them.
- `outlook.graph_request` is the Graph telemetry contract the Outlook sync
  monitors in `infra/stacks/monitoring` read. Every attempt records
  `outlook.throttle_origin` (`gate`, `graph` or `none`); a gate refusal
  (`RateLimitOrigin::Gate` with its `GateLimit`) sent nothing, so it is not
  a span error and logs at DEBUG. The span sets `operation.name` because
  Datadog files a client span with an HTTP method as `http.client.request`,
  and its `url.template` comes from `outlook/route.rs`, which keeps only
  known Graph path words so ids and user-chosen names never reach it. Record
  numeric fields as `i64`; unsigned values reach the collector as strings.
- `email_api_client_core::request_count::counted` counts the Graph requests one unit of work
  sends (the transport calls `record_sent`); Outlook token failures surface
  as `EmailApiError::CredentialsUnavailable`, apart from Graph failures.
- The Outlook calendar normalizer (`outlook/calendar/normalize.rs`,
  `recurrence.rs`) fails with `Rejected`, which names the Graph property
  path (`recurrence.range.endDate`, `instances.start.dateTime`), built only
  from literals so its log carries no event content, so the sync can skip and
  log that one event. Give a new check a `Rejected`, not `invalid()`. Graph
  leaves `originalStart` out of `instances` unless it is selected, so the
  request selects `INSTANCE_PROPERTIES` (Graph's default `event` properties
  plus `originalStart`); a new read of an instance property must be added
  there, since a `$select` returns nothing else. An exception still without
  one is left out of its series and reported as a `SkippedOccurrence`
  (`instances.originalStart.missing`); one Macro cannot parse rejects the
  series at `instances.originalStart`. Raise `READER_REVISION` with a change
  that lets Macro read events it skipped before, so delta calendars read
  them again. Graph names UTC `tzone://Microsoft/Utc` on meetings Exchange
  imported from another system's invitation, which `zones::zone` maps; a
  series end date in a legacy custom zone (`tzone://Microsoft/Custom`) is
  read in the zone the event's time is kept in. Calendar discovery reads the
  mailbox's `mailboxSettings.timeZone` (Windows or IANA) through the same
  table; a name it cannot map leaves the calendars without a zone and is
  reported as `OutlookDiscovery::unmapped_time_zone` rather than failing the
  account. `zones.rs` is CLDR's `windowsZones.xml` (territory `001`, in file
  order) with its `LICENSE` beside it; regenerate both from a new CLDR
  release when Windows adds zones. Keep out a zone whose IANA rules the
  bundled chrono-tz lacks: Outlook writes send local times computed with
  them, so stale rules move an event. British Columbia, Alberta and Manitoba
  Standard Time are held out that way until current tz data ships.
- Decode Graph JSON bodies with `transport::read_json`. `invalid_response`
  takes the field or shape that failed (`read_json` gives the JSON path and a
  missing field's name) and must never quote the response, which can carry
  mail content.
- An Outlook invitation whose `$value` read fails for anything but throttling
  or credentials still reads, with `MailboxMessage::calendar_parts_unavailable`
  set; mailbox sync decides whether to wait for the parts.
- Same-mailbox Outlook replies use `createReply`. When Graph refuses it with
  400 `ErrorInvalidOperation`, `create_draft` creates a standalone draft that
  carries the same correlation and RFC reply headers.


## Related

- Rules: `.agents/rules/rust/architecture.md`

