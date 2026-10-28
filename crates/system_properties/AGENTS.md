# system_properties

## What it is

Part of the shared properties feature — database operations for
system-managed properties: predefined properties (e.g. email attachments,
CRM stage definitions) that users apply to entities but cannot create or
delete. Consumed by CRM, projects, initiatives, and other entity-kind crates
for their fixed property catalogs.

## Start here

- `src/domain/service.rs`: `SystemPropertiesServiceImpl`, the entry point for
  setting/reading system property values.
- `src/domain/port.rs`: the repository port.
- `src/outbound/pgpool.rs`: the Postgres adapter.

## Scope

- Owns: the fixed catalog of system property definitions and the operations
  to attach their values to entities.
- Not here: user-defined properties → `crates/properties`; CRM-specific
  property usage → `crates/crm` (consumes this crate for stage definitions).

## Boundaries

- Depends on: `macro_user_id`, `macro_uuid`, `models_properties`, `sqlx`.
- Used by: `crates/crm`, `crates/initiative`, `crates/projects`,
  `crates/messages`, `crates/soup`, `crates/soup_realtime`, `crates/ai_tools`,
  `crates/agent_trigger`, `crates/item_filter_index`, `crates/task_dedup`,
  `services/agent_harness_service`, `services/agent_trigger_service`,
  `services/email_service`, `crates/scheduled_action`.

## Recipes

- Add a new system property: define it in `src/domain/mod.rs` (model) →
  `src/domain/port.rs` (repository method, if new storage shape) →
  `src/domain/service.rs` → `src/outbound/pgpool.rs`.

## Checks

- `cargo test -p system_properties` (`SQLX_OFFLINE` unset).
- After query changes: `nix develop --command just prepare_db` from the repo root.

## Related

- Rules: `.agents/rules/rust/db.md`
