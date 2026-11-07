# gtm_invite

## What it is

Belongs to growth/GTM tooling: personal, time-limited signup links Macro
staff create for prospects. Redeeming one attributes the new account to the
staff member and carries a promotional first month of Premium through
checkout.

## Start here

- `src/domain/service.rs`: create/redeem/revoke/list link lifecycle.
- `src/domain/ports.rs` + `src/domain/models.rs`: the repo port and link model.
- `src/inbound/axum_router/`: one file per route (`create_link`, `get_offer`,
  `redeem_link`, `resolve_link`, `revoke_link`, `list_links`); `gtm_macro_staff.rs`
  gates routes to Macro staff.
- `src/outbound/pg_gtm_invite_repo.rs`: the Postgres adapter.

## Scope

- Owns: GTM invite link creation, redemption, and the staff dashboard API.
- Not here: checkout's application of the promotional credit, or account
  creation itself.

## Boundaries

- Depends on: `macro_authorization` (axum), `rate_limit` (axum).
- Used by: `services/authentication_service`, which mounts the router in its
  `src/api.rs` and lists it in `src/api/swagger.rs`.

## Recipes

- Add a route: `src/domain/ports.rs` (if new repo behavior) →
  `src/domain/service.rs` → `src/inbound/axum_router/<name>.rs` →
  `src/inbound/axum_router.rs`.
- Change persistence: `src/outbound/pg_gtm_invite_repo.rs` → its `test.rs`.

## Checks

- `cargo test -p gtm_invite` (`SQLX_OFFLINE` unset).
- `nix develop --command just prepare_db` from the repo root after schema changes.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`
- Skill: `cloud-storage-hexagonal-architecture`
