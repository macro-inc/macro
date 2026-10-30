# Connect API

## What it is

The Macro Connect HTTP service. It serves the public catalog, creates OAuth
connect sessions, handles vendor callbacks, and stores and refreshes encrypted
grants in Connect's own Postgres database.

## Start here

- `src/main.rs`: router, customer auth middleware, catalog response, OpenAPI, CLI, and startup.
- `src/mcp.rs`: customer-authenticated MCP gateway, streaming response, and retry handling.
- `src/domain.rs` and `src/domain/oauth.rs`: connection and OAuth use cases,
  redirect-origin policy, grant cipher, and repository ports.
- `src/outbound.rs` and `src/outbound/oauth*.rs`: Connect Postgres repository,
  vendor OAuth adapter, and KMS/local envelope encryption.
- `src/outbound/mcp.rs`: shared vendor HTTP client and trace propagation for the gateway.
- `migrations/`: Connect-only SQLx schema.
- `../../crates/connect_registry/src/lib.rs`: embedded app model and validation.

## Scope

- Owns: HTTP routes, customer keys, connections, and encrypted grants for the Connect API.
- Not here: registry authoring → `connect_registry`; platform setup → `connect_platform`.

## Boundaries

- Depends on: `connect_registry`, `connect_platform`, third-party crates, and generated `workspace-hack`.
- Used by: public HTTP clients.

## Recipes

- Run locally: from the repo root, use a dedicated Connect Postgres database and `nix develop --command bash -lc 'export CARGO_TARGET_DIR="$CONNECT_CARGO_TARGET_DIR" DATABASE_URL="$CONNECT_DATABASE_URL"; cargo run -p connect_api'`, then request `http://localhost:8080/v1/catalog`.
- Set `CONNECT_PUBLIC_URL` to the full Connect base URL (including `/connect`
  behind the gateway). Only live `own_app` entries need `<ID>_CLIENT_ID` and
  `<ID>_CLIENT_SECRET` at startup. Set `CONNECT_KMS_KEY_ID` for KMS grants, or
  `CONNECT_LOCAL_WRAPPING_KEY` to a base64-encoded 32-byte key for local
  development. Startup fails without these values.
- `create-customer <name> --redirect-origin <origin>` accepts a repeatable
  origin and prints the customer API key once.
  `set-redirect-origins <customer_id> <origin>...` replaces the allowlist.
  Origins are HTTPS except for HTTP localhost and 127.0.0.1.
- Customer clients create sessions at `POST /v1/connect-sessions`. The browser
  follows the returned URL through vendor consent and callback; token export
  refreshes grants expiring within 60 seconds.
- Customer agents call `POST`, `GET`, or `DELETE`
  `/v1/users/{external_user_id}/mcp/{app_id}` with their customer key. The gateway
  forwards MCP traffic to a connected live app, refreshes once on vendor 401
  when the request body can be replayed, and returns `409 needs_reauth` after
  a second 401.
- Set `PORT` to change the listener port; set `OTEL_EXPORTER_OTLP_ENDPOINT` to export spans.
- Config keys read at startup: `DATABASE_URL`, `CONNECT_PUBLIC_URL`, own-app
  credentials, `CONNECT_KMS_KEY_ID` or `CONNECT_LOCAL_WRAPPING_KEY` (one
  required), `PORT` (default 8080), and the optional `OTEL_*` and `RUST_LOG`
  settings. `APP_SECRETS_JSON` is the sole source when present.
- On startup, `connect_api` applies its own SQLx migrations. The local compose
  `connect_db_init` creates the dedicated `connect` database first; deployed
  bootstrap is in `../../docs/runbooks/bootstrap.md`.
- `src/doppler_config.rs` validates the database, KMS, public URL, and live
  own-app keys in dev/prd Doppler once the project is bootstrapped.

## Checks

- `cargo nextest run --all-features -p connect_api`
- `cargo clippy -p connect_api --all-features --all-targets -- -D warnings`
- `cargo x deps --check` after `just hakari` when dependencies change.
