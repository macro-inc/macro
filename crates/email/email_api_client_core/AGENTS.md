# email_api_client_core

## What it is

Part of the Email feature: the provider-neutral half of email provider
integrations. It holds the vocabulary (`Message`, `Contact`, `SyncCursor`,
`SendRequest`, token/rate-limit errors), the capability ports adapters
implement, and the orchestration over them. The Gmail and Microsoft Graph
adapters are `crates/email/email_api_client_outbound`.

## Start here

- `src/service.rs`: `EmailApiClientServiceImpl<R, T, L>`, the orchestration
  layer, generic over a repository, token source, and request gate port;
  submodules `attachments`/`blocklist`/`contacts`/`labels`/`messages`/
  `raw_message`/`send`/`subscription`/`sync` hold one capability each.
- `src/ports.rs`: `ProviderRequestGate` (per-mailbox admission for the
  service above), `ProviderRateLimiter` (the Outlook `MailboxApiService`'s),
  `ProviderTokenSource`, and the repository traits adapters implement.
- `src/models/`: the provider-neutral models.

## Scope

- Owns: the provider-neutral vocabulary and orchestration over it.
- Not here: provider adapters → `crates/email/email_api_client_outbound`;
  Macro's own email domain (threads, scheduling) → `crates/email/email`; SQLx
  storage → `email_db_client`.

## Boundaries

- Depends on: `email_types`. Ports, service and request counting are behind
  the `ports` feature (which adds tokio).
- Used by: `crates/email/email` (ports only), `email_api_client_outbound`,
  `services/email_service`, `services/calendar_service`.

## Recipes

- Add a provider capability: a trait method on `src/ports.rs` → a submodule
  under `src/service.rs` → implement it in the outbound crate's
  `src/gmail.rs` / `src/outlook.rs` → tests alongside in
  `src/service/test.rs` / `test_support.rs`.

## Checks

- `cargo test -p email_api_client_core --all-features`

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
