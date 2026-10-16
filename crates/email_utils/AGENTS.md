# email_utils

## What it is

Part of the Email feature: shared email text handling — HTML sanitization,
reply-quote stripping, body parsing, contact name normalization, and
sender/generic-address checks.

## Start here

- `src/sanitizer.rs`: `sanitize_email_html`, `sanitize_authored_html`,
  `sanitize_html_fragment` — every HTML body that reaches
  `body_html_sanitized` must pass through one of these.
- `src/body_replyless.rs` + `src/body_replyless/`: strips quoted reply chains
  from HTML and plaintext bodies.
- `src/body_parsed.rs`: the parsed-body representation used across callers.

## Scope

- Owns: provider-neutral email text transforms with no I/O.
- Not here: provider API calls → `email_api_client`; DB storage →
  `email_db_client`; domain logic → `crates/email`.

## Boundaries

- Depends on: `ammonia`, `scraper` (no Macro crates).
- Used by: `crates/email`, `crates/email_db_client`, `crates/email_api_client`,
  `crates/graphql_email`, `crates/google_token`, `crates/models_email`,
  `services/calendar_service`, `services/email_service`.

## Recipes

- Add a sanitizer rule: `src/sanitizer.rs` (ammonia allowlist/`Builder`) →
  `src/sanitizer/test.rs`.
- Add a reply-stripping heuristic: `src/body_replyless/html_parser.rs` or
  `plaintext_parser.rs` → `src/body_replyless/test.rs`.

## Checks

- `cargo test -p email_utils`.

## Gotchas

- Enable `scraper`'s `deterministic` feature: thread reads recompute replyless
  HTML, and shuffled attributes rebuild otherwise unchanged email bodies.
- Sanitization is security-sensitive (XSS via email HTML): any allowlist
  change needs a test proving the previously-dangerous input is now stripped,
  not just that benign input survives.

## Related

- Rules: `.agents/rules/rust/security.md`
