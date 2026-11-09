# task_templates

## What it is

Task-template domain policy and primary PostgreSQL persistence for personal and team task configurations.

## Start here

- `src/domain.rs`: validation, current-membership authorization, and use cases.
- `src/outbound.rs`: conditional writes and primary database queries.

## Scope

- Owns: task-template content, immutable ownership, current team access, and revisions.
- Not here: Teams membership and roles → `crates/teams`.

## Boundaries

- Depends on: a Teams-backed membership port, `models_properties::api::SetPropertyValue`.
- Used by: document_storage_service REST handlers.

## Checks

- `cargo test -p task_templates` (requires migrated local MacroDB).
- After query changes: `nix develop --command just prepare_db`.

## Gotchas

- Creator attribution uses a nullable foreign key; personal ownership cascades on account deletion and team ownership survives it.
- Read Teams facts through the membership port; the template adapter never queries Teams-owned tables.
- Keep revision guards in storage and management policy in the domain service.
- Keep optional task title and `shareWithTeam` defaults inside typed JSONB configuration, separate from template identity and ownership; absent values require no migration.
- Accept a replayed creation ID only for the same creator, ownership, name, and configuration; recheck current team membership.
