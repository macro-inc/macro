# harnesses

## What it is

Belongs to agent sessions: registration for user-run agent harnesses
(macrod), called machines in the product. Owns device-code pairing (create,
approve, claim), the usable list and teammate directory the UI renders, team
access, residents, revocation, and the bound-agent listing the daemon reconciles
its webhook feed from.
Hosted computers register through trusted `create_hosted_pairing`: it creates
an approved pairing with the buying administrator as human owner and a User
(`edit`) grant for the computer's team. Retries before
claim rotate the secret; retries after claim revoke old tokens and re-key the
same harness. Both preserve owner, grants, agent bindings, and computer identity.
Claim and re-key serialize on the harness row. `revoke_hosted_harness`,
`harness_computer` and `computer_harness` are the other trusted control-plane
entry points. The control plane deletes a computer's agents before
`revoke_hosted_harness`, whose soft delete would otherwise only unbind them.
`hosted_pairing_claimed(pairing_id)` reads the durable pairing claim for the
fleet generation gate, including the interval before macrod connects. Hosted
claims take the same `hosted-enrollment:<computer UUID>` advisory guard as
fleet Create before the harness lock, then recheck the presented device-secret
hash while claiming. A claim waiting through rotation cannot use its old secret.
Expiry cleanup retains claimed pairing rows for live hosted harnesses; a missing
pairing fails closed rather than treating the guest as unclaimed.
These trusted entry points take no caller: they are for trusted in-process callers that
already authorized the team admin, never for an HTTP route.
Hosted harnesses always start with `allow_permission_bypass` on ("Don't ask
before acting"); paired machines keep it off until their owner turns it on.

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
  `entity_access` that makes every member a User; Macro computers are team
  machines from birth, and the teammate directory lists them to every member
  of the computer's team.
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
  `crates/agent_session`, `coding_agent_worker`.

## Boundaries

- Depends on: `harness_id`, `harness_token`, `bot_id`, `macro_authorization`,
  `entity_access_db_utils`, `models_permissions`.
- Used by: `coding_agent_worker`.

- `authorize_harness(caller, harness_id, HarnessPermission::{View, Use, Manage})` is
  the access boundary for other services' routes: View requires effective
  access; Use requires Owner or User; Manage is the owner, or an owner of a
  team the runtime is shared with (take it out of service). `set_claude_mode`
  (trusted) records a `ClaudeModeChange` once macrod confirmed it: `SignedIn
  { signed_in_by }` writes `own_account` with `claude_signed_in_by` and
  `claude_signed_in_at`; `SignedOut` writes `macro_credits` and clears both.
  The control plane's Claude sign-in notices go to that signer.
- `patch_harness` lets managers change the name and permission bypass while
  preserving computer identity, capabilities, and Claude billing mode.
- Harness rows carry `capabilities` (jsonb, `HarnessCapabilities`, e.g.
  `screen`), which macrod reports through `PUT /harnesses/me/capabilities`,
  stamping `capabilities_reported_at`,
  and `computer_id` (set only for Macro computers; unique among live rows).
  The authenticated harness may replace only its own report.

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

- `HostedPairing.device_secret` redacts formatting and zeroizes on drop; use `expose()` only at enrollment boundaries.

- Pairing and computer ports use the leaf `pairing_id::PairingId` and `computer_id::ComputerId`; unwrap UUIDs only at adapter boundaries.

- New hosted-registration and metadata persistence failures use typed adapter errors with rootcause reports; existing repository callers retain their error contract.

- `pg_harness_repo/hosted_pairing.rs` owns hosted enrollment and computer lookups; `metadata.rs` persists capabilities and Claude mode.
