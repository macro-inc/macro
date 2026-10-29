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

- `cargo test -p email_api_client --all-features`. The Outlook calendar
  mutation tests in `src/outbound/outlook/calendar/test/mutations.rs` drive the
  calendar domain service against Postgres through `#[sqlx::test]`, so they
  need the local test database from
  [Database development](../../docs/development/database.md).

## Gotchas

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
  to the call's outcome.
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
  through `request`/`conditional_request` rather than the raw client.

## Related

- Rules: `.agents/rules/rust/architecture.md`
