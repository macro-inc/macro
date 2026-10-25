# email_api_client

## What it is

Part of the Email feature: provider-neutral contracts and models for email
provider integrations (sync, send, tokens, rate limits), plus the Gmail and
Outlook (Microsoft Graph) outbound adapters.

## Start here

- `src/domain/service.rs`: `EmailApiClientServiceImpl<R, T, L>` — the
  orchestration layer, generic over a repository, token source, and rate
  limiter port; submodules `attachments`/`blocklist`/`contacts`/`labels`/
  `messages`/`send`/`subscription`/`sync` hold one capability each.
- `src/domain/ports.rs`: `ProviderRateLimiter`, `ProviderTokenSource`, and the
  repository trait adapters implement.
- `src/outbound/gmail.rs`: the Gmail adapter (feature `outbound-gmail`).
- `src/outbound/outlook.rs`: the Microsoft Graph adapter (feature
  `outbound-outlook`); every Graph call goes through `outlook/transport.rs`,
  which owns request headers, provider error mapping, and write-failure logs.

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

- `cargo test -p email_api_client --all-features`.

## Gotchas

- `#![deny(missing_docs)]`.
- The service is generic over `<R, T, L>` (repository, token source, rate
  limiter) — add a new dependency as a port + generic bound, not a concrete
  field.
- Link-based reads go through `read_with_token`, which retries once with a
  fresh token when the provider answers `AuthRequired`; a cached token can
  outlive a revoked grant, and only the fresh fetch lets the token source mark
  the link for reauthorization. Writes use `prepare` and do not retry.
- Graph answers a bodyless POST or PATCH without `Content-Length: 0` with 411
  Length Required. `transport.rs` adds the header, so new Graph calls must go
  through `request`/`conditional_request` rather than the raw client.

## Related

- Rules: `.agents/rules/rust/architecture.md`
