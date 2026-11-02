# Connect platform

## What it is

Shared startup configuration, AWS SDK config loading, OpenTelemetry setup, and
inbound HTTP tracing for Macro Connect services.

## Start here

- `src/config.rs`: one environment snapshot and `APP_SECRETS_JSON` precedence.
- `src/lib.rs`: default AWS SDK config loading.
- `src/telemetry.rs`: tracing subscriber and optional OTLP export.
- `src/http.rs`: request spans, W3C parent extraction, and outbound trace header injection.

## Scope

- Owns: Connect's process configuration and transport telemetry.
- Not here: service-specific settings or routes → `connect/services/connect_api`.

## Boundaries

- Depends on: third-party crates and generated `workspace-hack` only.
- Used by: `connect_api`, `connect_client`, and future Connect services.

## Recipes

- Run `connect_api` locally with a dedicated Connect Postgres database and either `CONNECT_KMS_KEY_ID` or a base64-encoded 32-byte `CONNECT_LOCAL_WRAPPING_KEY`; see `../../services/connect_api/AGENTS.md` for the command. Then request `http://localhost:8080/health`.

## Checks

- `cargo nextest run --all-features -p connect_platform`
- `cargo clippy -p connect_platform --all-features --all-targets -- -D warnings`
- `cargo x deps --check` after `just hakari` when dependencies change.
