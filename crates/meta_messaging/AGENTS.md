# meta_messaging

Owns Meta authorization, provider account lifecycle, webhook ingestion and the
adapter behind native customer messaging. Domain policy lives in `src/domain`;
`src/inbound` adapts HTTP/webhooks; `src/outbound` implements provider, encrypted
credential and database ports. DSS wires the native channel and access adapters.

## OAuth boundary

Instagram completion requires the independent browser proof returned at begin,
plus the initiating authenticated Macro team/user and current admin access.
Never add a public state-only completion path. WhatsApp uses Embedded Signup.
See `docs/META_MESSAGING.md` for redirect configuration and rollout gates.

## Checks

- `cargo test -p meta_messaging --all-features` with SQLX_OFFLINE unset and an
  isolated migrated local database.
- DSS HTTP fixtures in `native_messaging/native/test/http/oauth.rs` exercise the
  actual domain, repository and access checks with a controlled provider.
- Regenerate the storage OpenAPI contracts when authorization DTOs change.
