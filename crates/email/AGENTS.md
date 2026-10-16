# email

## What it is

The core of the Email feature: threads/messages orchestration, scheduling
and reminders/followups, calendar-invitation extraction, and the AI email
tools — hexagonal, heavily feature-gated.

## Start here

- `src/domain/service.rs` + `src/domain/ports.rs`: the domain service and the
  traits its adapters implement.
- `src/inbound/axum.rs`: HTTP routes (feature `axum`); `src/inbound/toolset.rs`:
  the AI email tools (feature `ai_tools`).
- `src/outbound/email_pg_repo.rs`, `src/outbound/invitation_pg.rs`: Postgres
  adapters (feature `outbound`); `src/outbound/email_service_http.rs`: calls
  into `email_service`; `src/outbound/s3_draft_attachment_storage.rs`: staged
  draft attachments (feature `s3`).

## Scope

- Owns: email/thread domain logic, scheduled delivery, reminders/followups,
  calendar invitation extraction and resolution.
- Not here: raw provider API calls → `email_api_client`; HTML
  parsing/sanitization → `email_utils`; SQLx queries over email tables →
  `email_db_client`.

## Boundaries

- Depends on: `entity_access`, `entity_access_management`, `email_utils`,
  `crm`, `frecency`, `item_filters`, `lexical_client`, `macro_event_broker`,
  `calendar_events` (optional, feature `calendar_invitations`).
- Used by: many crates and services, including `ai_tools`, `graphql_email`,
  `teams`, `databases_sql`, `work_feed`, `calendar_service`, `email_service`,
  `email_scheduled_handler`, `search_processing_service`.

## Recipes

- Add a route: `src/inbound/axum.rs` → `src/domain/service.rs` →
  the relevant `src/outbound/*.rs` adapter.
- Add an AI tool: `src/inbound/toolset.rs` → `src/domain/service.rs`.
- Add a feature-gated adapter: add the optional dependency and a feature in
  `Cargo.toml` → `src/outbound/<name>.rs` → declare it in `src/outbound.rs`.

## Checks

- `cargo test -p email --all-features` (`SQLX_OFFLINE` unset; the `outbound`
  feature's tests need a local MacroDB — `just setup_macrodb`).

## Gotchas

- The feature matrix (`ports`/`inbound`/`outbound`/`http_client`/`s3`/
  `gmail_token`/`ai_tools`/`attachment`/`calendar_invitations`/`axum`) gates
  most modules; check `Cargo.toml`'s `[features]` block for which one a new
  dependency belongs under before wiring it in.
- `domain/ports.rs` defines the traits adapters implement — call through the
  domain service, never an outbound adapter directly from another crate.

## Related

- Rules: `.agents/rules/rust/architecture.md`
