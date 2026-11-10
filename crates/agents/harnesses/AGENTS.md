# harnesses

## What it is

Belongs to agent sessions: registration for user-run agent harnesses
(macrod), called machines in the product. Owns device-code pairing (create,
approve, claim), the usable list and teammate directory the UI renders, team
access, residents, revocation, and the bound-agent listing the daemon reconciles
its webhook feed from.

## Start here

- `src/domain/service.rs`: pairing, listing, revocation logic.
- `src/domain/tokens.rs`: harness token minting/verification
  (`constant_time_eq` comparison — don't swap in a non-constant-time check).
- `src/domain/ports.rs` + `src/domain/models.rs`: repo port and harness model.
- `src/inbound/axum_router.rs`: the HTTP surface.
- `src/outbound/pg_harness_repo.rs`: the Postgres adapter.

## Scope

- Owns: harness registration, pairing, team access, and the agent-binding list.
- Every harness has one person as owner. Everyone else has a role: No Access
  (sees it exists), Read (`view`, cannot run agents), User (`edit`, can run
  agents), or their agent is a Resident. A team machine is a team grant in
  `entity_access` that makes every member a User.
- The SQL function `harness_access_level` is the one rule for a person's level,
  and `harness_can_run` for running agents on it; check the latter wherever
  something runs. A direct grant counts only while its holder shares a team with
  the owner.
- Opening a machine takes the owner's own session
  (`MacroUserAuthentication::is_human_session`): agents can ask, never grant.
- A resident is a bound agent with `is_coding` false. There is no move-in or
  eviction flow yet; the binding is all there is.
- Direct grants and access requests go through `crates/access_requests`
  (`ShareEntityType::Harness`, whose levels are `view` and `edit`).
- Not here: running an agent session or the ACP protocol itself →
  `crates/agents/agent_session`, `macrod`.

## Boundaries

- Depends on: `harness_id`, `bearer_token`, `bot_id`, `macro_authorization`,
  `entity_access_db_utils`, `permissions_types`.
- Used by: `macrod`.

## Recipes

- Add a registration field or state: `src/domain/models.rs` →
  `src/domain/service.rs` → `src/outbound/pg_harness_repo.rs` →
  `src/inbound/axum_router.rs`.
- Change token scope/verification: `src/domain/tokens.rs` → its callers in
  `src/domain/service.rs`.

## Checks

- `cargo test -p harnesses` (`SQLX_OFFLINE` unset).

## Gotchas

- `Harness.connected` reads `harness_runtime_connection`: true while a row has an
  unexpired lease. `agent_harness_service` writes those rows per connection. With
  no rows at all it falls back to `last_connected_at > last_disconnected_at`, for
  connections held by replicas older than the rows; remove that once none remain.
- `GET /harnesses/me` logs `harness_presence_disagreement` when the daemon sends
  `RUNTIME_CONNECTED_HEADER` and the harness reads offline
  (`infra/stacks/monitoring/monitors/harness-presence.ts` alerts on it).
- Deleting a harness only stamps `deleted_at`; a database trigger then nulls
  `agent_configs.harness_id` for its agents, as a hard delete's `SET NULL` would.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`
- Skill: `cloud-storage-hexagonal-architecture`
