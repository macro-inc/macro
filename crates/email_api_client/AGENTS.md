# email_api_client

## What it is

Part of the Email feature: provider-neutral contracts and models for email
provider integrations (sync, send, tokens, rate limits), plus the Gmail and
Outlook (Microsoft Graph) outbound adapters.

## Start here

- `src/domain/service.rs`: `EmailApiClientServiceImpl<R, T, L>` — the
  orchestration layer, generic over a repository, token source, and request
  gate port; submodules `attachments`/`blocklist`/`contacts`/`labels`/
  `messages`/`raw_message`/`send`/`subscription`/`sync` hold one capability
  each.
- `src/domain/ports.rs`: `ProviderRequestGate` (per-mailbox admission for the
  service above), `ProviderRateLimiter` (the Outlook `MailboxApiService`'s),
  `ProviderTokenSource`, and the repository traits adapters implement.
- `src/outbound/gmail.rs`: the Gmail adapter (feature `outbound-gmail`).
- `src/outbound/outlook.rs`: the Microsoft Graph adapter (feature
  `outbound-outlook`); every Graph call goes through `outlook/transport.rs`,
  which owns request headers, provider error mapping, write-failure logs,
  and one `outlook.graph_request` span per attempt (with an
  `outlook.graph_admission` child for the per-mailbox gate wait).
- `src/outbound/microsoft_gate.rs`: the Redis admission every Graph request
  passes (window, concurrency, cooldown), which also counts admitted requests
  per sync generation.

## Scope

- Owns: the provider-neutral vocabulary (`Message`, `Contact`, `SyncCursor`,
  `SendRequest`, token/rate-limit errors) and orchestration over it.
- Not here: Macro's own email domain (threads, scheduling) → `crates/email`;
  SQLx storage → `email_db_client`.

## Boundaries

- Depends on: `email_utils`, `models_email`, `gmail_client` (feature
  `outbound-gmail`), `calendar_events` (feature `outbound-outlook`).
- Used by: `crates/email` (ports only), `services/email_service`,
  `services/calendar_service`.

## Recipes

- Add a provider capability: a trait method on `src/domain/ports.rs` → a
  submodule under `src/domain/service.rs` → implement it in
  `src/outbound/gmail.rs` → tests alongside in `src/domain/service/test.rs`
  / `test_support.rs`.

## Checks

- `cargo test -p email_api_client --all-features`. The Outlook calendar
  mutation tests in `src/outbound/outlook/calendar/test/mutations.rs` drive the
  calendar domain service against Postgres through `#[sqlx::test]`, so they
  need the local test database from
  [Database development](../../docs/development/database.md).

## Gotchas

- Undated provider drafts use creation time for All Mail eligibility; spam/junk
  and trash remain excluded. Keep ingestion, recomputation, and cached projections aligned.

- `#![deny(missing_docs)]`.
- The service is generic over `<R, T, L>` (repository, token source, request
  gate) — add a new dependency as a port + generic bound, not a concrete
  field.
- Every provider call holds a `ProviderRequestGate` permit (`RequestPermit`)
  for its duration and finishes it with the call's error, so a provider rate
  limit cools the mailbox down for every caller. A permit dropped unfinished,
  by a cancelled future or an undispatched `PreparedSendMessage`, releases
  itself. New service methods go through `read_with_token` or
  `call_with_token`; a call made with a bare token is invisible to the
  in-flight cap. Their spans declare `gate_in_flight` and `gate_cap` as
  empty fields, which admission fills with the mailbox's load so it sits next
  to the call's outcome. Paginated reads (history, contacts) are page-level
  ports that the service loops over, one permit per page, so every page is
  charged to the mailbox's window and checks its cooldown; a refused page
  fails the read, and the span keeps the last page's load. Keep new paginated
  provider calls page-level rather than looping in the adapter.
- Link-based reads go through `read_with_token`, which retries once with a
  fresh token when the provider answers `AuthRequired`; a cached token can
  outlive a revoked grant, and only the fresh fetch lets the token source mark
  the link for reauthorization. Contact listings use `retry_with_fresh_token`
  to keep their WARN-level logging. Writes use `call_with_token` and do not
  retry.
- `SendRequest::build_mime` (Gmail sends) turns an inline `text/calendar`
  attachment with no Content-ID into the message's calendar body, the last
  alternative after the text and HTML, which is how an answerable invitation
  (RFC 6047) is sent; other files stay attachments. Outlook sends do not go
  through it.
- Graph answers a bodyless POST or PATCH without `Content-Length: 0` with 411
  Length Required. `transport.rs` adds the header, so new Graph calls must go
  through `request`/`conditional_request` rather than the raw client. A GET
  whose 404 means "there is none" (a contact without a photo) uses
  `optional_request`, so the 404 is not a span error. Use
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
- Graph reads `$top` on a delta request as a cap on the whole round, not a
  page size: it stops at that many items and returns the deltaLink, so the
  rest of the folder is never listed and later rounds never return it. Never
  put `$top` on a delta request; size its pages with
  `Prefer: odata.maxpagesize` instead. The mail-folder delta reads through
  `transport::get_delta_page`, which sends it as its own `Prefer` line on
  every page, since the nextLink does not carry it.
- `domain::request_count::counted` counts the Graph requests one unit of work
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
