# harnesses

## What it is

Belongs to agent sessions: registration for macrod, called runtimes in the
product. Owns device-code pairing, the usable list and teammate directory,
team access, residents, revocation, and the daemon's bound-agent feed.
Hosted computers register through trusted `create_hosted_pairing`: it creates
an approved pairing with the buying administrator as human owner and a team
grant (Read for agent computers, User for ordinary computers). Retries before
claim rotate the secret; retries after claim revoke old tokens and re-key the
same harness. Both preserve owner, grants, agent bindings, and computer identity.
Claim and re-key serialize on the harness row. `revoke_hosted_harness` and
`harness_computer` are the other trusted control-plane entry points.

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
  `entity_access`: ordinary computers grant User; dedicated agent computers
  grant Read, their assigned account is a Resident, and their own-team human
  administrators retain management through the shared access rule.
- The SQL function `harness_access_level` is the one rule for a person's level,
  and `harness_can_run` for running agents on it; check the latter wherever
  something runs. A direct grant counts only while its holder shares a team with
  the owner.
- Opening a runtime takes the owner's own session
  (`MacroUserAuthentication::is_human_session`): agents can ask, never grant.
- Residents are tagged `bot` (a binding with `is_coding` false) or `account`
  (the dedicated computer's bound team-agent account). Account residents can
  view but cannot execute as macrod's host user. Persona metadata or a bound
  team-agent account classifies an agent computer, including pending enrollment.
- Direct grants and access requests go through `crates/access_requests`
  (`ShareEntityType::Harness`, whose levels are `view` and `edit`).
- Not here: running an agent session or the ACP protocol itself →
  `crates/agent_session`, `coding_agent_worker`.

## Boundaries

- Depends on: `harness_id`, `harness_token`, `bot_id`, `macro_authorization`,
  `entity_access_db_utils`, `models_permissions`.
- Used by: `coding_agent_worker`.

- `authorize_harness(caller, harness_id, HarnessPermission::{View, Use, Manage})` is
  the access boundary for other services' routes: View requires effective
  access; Use requires Owner or User; Manage follows effective Owner, with the
  ordinary shared-runtime team-owner lifecycle rule. Agent computers never
  use that fallback for grants outside their owning team. `set_claude_mode` (trusted) records
  `claude_mode` (`macro_credits` | `own_account`) once macrod confirmed it.
- `patch_harness` lets managers change the name and permission bypass while
  preserving computer identity, capabilities, and Claude billing mode.
- Harness rows carry `capabilities` (jsonb, `HarnessCapabilities`, e.g.
  `screen` and `personas`), which macrod reports through `PUT /harnesses/me/capabilities`,
  and `computer_id` (set only for Macro computers; unique among live rows).
  `personas` maps OS username to a tagged `PersonaHealth` observation:
  healthy/unhealthy/missing, `checked_at`, `last_turn_at`, and a bounded last
  error for unhealthy/missing. Old reports and rows default to an empty map.
  The authenticated harness may replace only its own report; the existing JSON
  repository path stores it without a schema migration. Treat observations as
  live only while harness connection presence is live and `checked_at` is recent.

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

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`
- Skill: `cloud-storage-hexagonal-architecture`
