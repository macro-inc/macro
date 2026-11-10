# unfurl

## What it is

Shared infrastructure for link previews, used by channel messages, email, and
CRM — a hex crate
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
- Used by: `services/unfurl_service`, `services/email_service`, `crates/crm`,
  `crates/messages` (channel message link previews, run in DSS).

## Checks

- `cargo test -p unfurl --all-features` (`SQLX_OFFLINE` unset); the fetcher's
  tests need the `outbound` feature.

## Gotchas

- Any change to URL validation or redirect handling must keep private/loopback
  IPs blocked — see `src/outbound/http_safety.rs`'s doc comment.
- The fetcher's client sends a named `User-Agent`; keep it on any new client.
  Many sites answer 403 to requests without one, and reqwest sends none.
- A description is the first of `og:description`, `twitter:description`,
  `<meta name="description">`, and the first paragraph of the page's
  `<main>`/`<article>` that has text (`GetUnfurlResponse::get_description`),
  on one line and cut to 500 characters. Encyclopedia articles have only the
  paragraph.
- The fetcher reads the first 1 MB of a page and parses that; it does not
  refuse a longer page. Video pages run past it and still carry their tags
  within it.
- `services/unfurl_service`'s bulk route (`src/unfurl.rs`) is a separate, older
  implementation with neither of the two behaviors above.

## Related

- Rules: `.agents/rules/rust/security.md`
