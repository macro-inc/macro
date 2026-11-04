# harnesses

## What it is

Belongs to agent sessions: registration for user-run agent harnesses
(macrod), called runtimes in the product. Owns device-code pairing (create,
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
- Opening a runtime takes the owner's own session
  (`MacroUserAuthentication::is_human_session`): agents can ask, never grant.
- A resident is a bound agent with `is_coding` false. There is no move-in or
  eviction flow yet; the binding is all there is.
- Direct grants and access requests go through `crates/access_requests`
  (`ShareEntityType::Harness`, whose levels are `view` and `edit`).
- Not here: running an agent session or the ACP protocol itself →
  `crates/agent_session`, `coding_agent_worker`.

## Boundaries

- Depends on: `harness_id`, `harness_token`, `bot_id`, `macro_authorization`,
  `entity_access_db_utils`, `models_permissions`.
- Used by: `coding_agent_worker`.

## Recipes

- Add a registration field or state: `src/domain/models.rs` →
  `src/domain/service.rs` → `src/outbound/pg_harness_repo.rs` →
  `src/inbound/axum_router.rs`.
- Change token scope/verification: `src/domain/tokens.rs` → its callers in
  `src/domain/service.rs`.

## Checks

- `cargo test -p harnesses` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`
- Skill: `cloud-storage-hexagonal-architecture`
