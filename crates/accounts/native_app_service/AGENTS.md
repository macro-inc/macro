# native_app_service

## What it is

Part of the native apps (Tauri desktop and iOS). Server-side handlers for
updating them: update checks and version negotiation.

## Start here

- `src/lib.rs`: module map — `domain` (business logic), `inbound` (axum
  handlers), `outbound` (port implementations).
- `src/domain/service.rs` + `src/domain/ports.rs`: update-check policy and
  the ports it depends on.
- `src/tests.rs`: service-level tests.

## Scope

- Owns: deciding what update (if any) a native app build should receive.
- Not here: building or publishing the app binaries themselves → the native
  app's own release pipeline.

## Boundaries

- Depends on: `macro_env_var` for config.
- Used by: `services/authentication_service` (mounts the router with
  `axum::Router::with_state`).

## Checks

- `cargo test -p native_app_service` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/guardrails.md`
