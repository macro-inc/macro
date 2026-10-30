# Connect API

## What it is

The Macro Connect HTTP service. It serves the public catalog, creates OAuth
connect sessions, handles vendor callbacks, and stores and refreshes encrypted
grants in Connect's own Postgres database.

## Start here

- `src/main.rs`: router, customer auth middleware, catalog response, OpenAPI, CLI, and startup. Customer-facing wire types come from `connect_client::wire`.
- `src/mcp.rs`: customer-authenticated MCP gateway, streaming response, and retry handling.
- `src/domain.rs` and `src/domain/oauth.rs`: connection and OAuth use cases,
  redirect-origin policy, grant cipher, and repository ports.
- `src/outbound.rs` and `src/outbound/oauth*.rs`: Connect Postgres repository,
  vendor OAuth adapter, and KMS/local envelope encryption.
- `src/outbound/mcp.rs`: shared vendor HTTP client and trace propagation for the gateway.
- `migrations/`: Connect-only SQLx schema.
- `Dockerfile`: multi-stage standalone container build from the repository root.
- `../../crates/connect_registry/src/lib.rs`: embedded app model and validation.

## Scope

- Owns: HTTP routes, customer keys, connections, and encrypted grants for the Connect API.
- Not here: registry authoring → `connect_registry`; platform setup → `connect_platform`.

## Boundaries

- Depends on: `connect_registry`, `connect_platform`, `connect_client::wire`, third-party crates, and generated `workspace-hack`.
- Used by: public HTTP clients.

## Recipes

- Run locally: from the repo root, use `docker compose -f connect/docker-compose.yml up --build`, then request `http://localhost:8080/v1/catalog`. Set `CONNECT_PORT` when 8080 is in use. See `../../docs/runbooks/bootstrap.md` for the customer creation command.
- Set `CONNECT_PUBLIC_URL` to the Connect host root. Only live `own_app` entries need `<ID>_CLIENT_ID` and
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
- On startup, `connect_api` applies its own SQLx migrations. Local Compose
  creates the dedicated `connect` database; deployed bootstrap is in
  `../../docs/runbooks/bootstrap.md`.

## Checks

- `cargo nextest run --all-features -p connect_api`
- `cargo clippy -p connect_api --all-features --all-targets -- -D warnings`
- `cargo x deps --check` after `just hakari` when dependencies change.

## Gotchas

- Database tests create each database from `template0` because CI pre-migrates
  `template1` with Macro's schema and migration history, which conflicts with
  Connect's separate migrator.
