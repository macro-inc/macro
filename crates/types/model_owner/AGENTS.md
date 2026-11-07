# model_owner

## What it is

Shared infrastructure used by nearly every domain crate with typed
ownership. A typed owner reference (`Owner`/`OwnerType`) for Macro entities
— a user, bot, or team principal, distinct from the acting user.

## Start here

- `src/lib.rs`: `Owner`, `OwnerType`, parsing/display of the
  `user|bot|team` principal string forms.
- `src/creation_principal.rs`: `CreationPrincipal` — who created an entity,
  separate from who owns it.
- `src/team.rs`: team-link audience policy (`OwnerTeamFacts`) — who an
  owner's team-link grants access to; PostgreSQL's `owner_team` is the
  set-based twin of this function and is tested against it.

## Scope

- Owns: the `Owner`/`OwnerType`/`CreationPrincipal` value types and the
  team-audience policy function.
- Not here: whether an owner actually has access to an entity →
  `models_permissions`, `entity_access`.

## Boundaries

- Depends on: `bot_id`, `macro_user_id`.
- Used by: nearly every domain crate with typed ownership — `agent_session`,
  `agent_trigger`, `bots`, `channels`, `databases_sql`, `documents`,
  `entity_access`, `entity_registry`, `model`, `model_notifications`,
  `models_permissions`, `models_soup`, `projects`, `scheduled_action`,
  `soup`, `teams`, and more.

## Checks

- `cargo test -p model_owner` (`SQLX_OFFLINE` unset; enable the `sqlx` feature
  to exercise the Postgres type impl: `cargo test -p model_owner --features sqlx`).

## Gotchas

- `team.rs`'s `OwnerTeamFacts` must stay in lockstep with the `owner_team` SQL
  set logic — a behavior change needs matching adapter tests on both sides.

## Related

- Rules: `.agents/rules/rust/architecture.md`
