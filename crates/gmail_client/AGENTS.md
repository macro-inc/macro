# gmail_client

## What it is

Backs the Email feature's Gmail sync: a thin Gmail API client, `GmailClient`,
wrapping per-area modules (messages, threads, labels, filters, history,
contacts, watch) behind a single public facade; most modules are
`pub(crate)`.

## Start here

- `src/lib.rs`: `GmailClient`, its constructors (`new` vs. `new_with_urls` for
  injectable endpoints in tests), and `sanitize_error_body` — every error body
  is redacted (emails) and length-capped before it can reach logs.
- `src/auth.rs`: Google JWT verification for push notifications.
- `src/watch.rs`: Gmail push notification (`users.watch`) setup.
- `src/test.rs` + each module's own `test.rs`: `wiremock`-backed HTTP tests,
  one server per test via `new_with_urls`.

## Scope

- Owns: typed request/response calls against the Gmail REST API.
- Not here: Macro's email domain model or sync orchestration →
  `models_email` (the wire types this crate returns), `email_service`.

## Boundaries

- Depends on: `models_email` (response/request types).
- Used by: `email_service`, `email_api_client`.

## Recipes

- Add a new Gmail endpoint: new or existing `src/<area>.rs` function →
  `pub(crate) mod` it in `src/lib.rs` → re-export only what callers need →
  `wiremock` test in `src/<area>/test.rs`.

## Checks

- `cargo test -p gmail_client`.

## Gotchas

- Any new error path should go through `sanitize_error_body` (or an
  equivalent) before logging — Gmail error bodies can contain email addresses.

## Related

- Rules: `.agents/rules/config-and-service-urls.md`
