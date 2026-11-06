# unfurl_service

## What it is

Shared infrastructure for rendering link previews wherever a URL is pasted
(documents, chat, email). A deployable service that fetches link previews
(title, description, image, favicon) for arbitrary URLs and proxies image
responses, with SSRF protections since both accept user-supplied URLs.

## Start here

- `src/unfurl.rs` + `src/api/unfurl/get_unfurl.rs`: the unfurl domain logic
  and its HTTP handler.
- `src/http_safety.rs` + `src/http_safety/resolver.rs`: the shared
  SSRF-safe HTTP client — private-IP filtering resolver, redirect limits,
  size limits. Both unfurl and proxy fetches go through this.
- `src/api/proxy.rs`: the image proxy endpoint.

## Scope

- Owns: fetching and parsing link metadata, and safely proxying external
  images, for any caller inside Macro.
- Not here: anything unrelated to fetching third-party URLs.

## Checks

- `cargo test -p unfurl_service` (`SQLX_OFFLINE` unset).

## Gotchas

- Any change that fetches a user-supplied URL must go through
  `SsrfSafeHttpClient` in `src/http_safety.rs` — it blocks internal/private
  IPs including after redirects, which a plain `reqwest::Client` would not do
  (see PR history: `fix(unfurl): prevent ssrf`, #5708).
- `MAX_REDIRECTS` (5) and response size limits are enforced per-request, not
  globally; a new endpoint that fetches external content needs to apply them
  itself.

## Related

- Rules: `.agents/rules/rust/security.md`
