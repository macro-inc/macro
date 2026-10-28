# roles_and_permissions

## What it is

Part of shared infrastructure. Domain for user roles and permissions (not
item-level sharing — see Scope).

## Start here

- `src/domain/model.rs`: the role/permission types.
- `src/domain/port.rs` + `src/domain/service.rs`: the port trait and its
  default implementation.
- `src/outbound/pgpool.rs`: the Postgres adapter (`outbound` feature).

## Scope

- Owns: user-level role/permission domain logic and its Postgres adapter.
- Not here: item/document share permissions → `share_permission_db_utils`;
  authorization decisions for a request → `macro_authorization`.

## Boundaries

- Depends on: `macro_user_id`, `non_empty`.
- Used by: `agent_inmem`, `ai_billing`, `chat`, `teams`.

## Recipes

- Add a permission check: `src/domain/model.rs` → `src/domain/port.rs` →
  `src/domain/service.rs` → `src/outbound/pgpool.rs`.

## Checks

- `cargo test -p roles_and_permissions` (`SQLX_OFFLINE` unset).

## Related

- Skill: `cloud-storage-hexagonal-architecture` · Rules: `.agents/rules/rust/security.md`
