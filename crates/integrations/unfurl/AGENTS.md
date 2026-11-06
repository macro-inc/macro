# unfurl

## What it is

Shared infrastructure for link previews, used by email and CRM — a hex crate
for URL unfurling: fetches a URL's meta tags (title, description, image,
favicon) with SSRF protections.

## Start here

- `src/domain/service.rs`: the unfurl workflow.
- `src/outbound/http_safety.rs`: URL validation and private-IP blocking —
  read before touching any outbound fetch path, it's what keeps this crate
  from being an SSRF vector against the internal network.
- `src/outbound/reqwest_fetcher.rs`: the real HTTP fetcher.
- `src/inbound/axum_router.rs` (feature `axum`): HTTP routes.

## Scope

- Owns: fetching and parsing a URL's unfurl metadata.
- Not here: rendering the unfurl card in the UI, or caching it long-term.

## Boundaries

- Depends on: `scraper`, `reqwest` (feature `outbound`).
- Used by: `services/unfurl_service`, `services/email_service`, `crates/crm`.

## Checks

- `cargo test -p unfurl` (`SQLX_OFFLINE` unset).

## Gotchas

- Any change to URL validation or redirect handling must keep private/loopback
  IPs blocked — see `src/outbound/http_safety.rs`'s doc comment.

## Related

- Rules: `.agents/rules/rust/security.md`
