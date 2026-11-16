# harnesses

## What it is

Belongs to agent sessions: registration for user-run agent harnesses
(macrod), called machines in the product. Owns device-code pairing (create,
approve, claim), the usable list and teammate directory the UI renders, team
access, residents, revocation, and the bound-agent listing the daemon reconciles
its webhook feed from.
Hosted computers register through trusted `create_hosted_pairing`: it creates
an approved pairing with the buyer recorded as `owner` and a User (`edit`)
grant for the computer's team. The recorded owner confers nothing on a
computer: see `harness_access_level` below. Retries before
claim rotate the secret; retries after claim revoke old tokens and re-key the
same harness. Both preserve owner, grants, agent bindings, and computer identity.
Claim and re-key serialize on the harness row. `revoke_hosted_harness`,
`harness_computer` and `computer_harnesses` are the other trusted control-plane
entry points. `delete_harness` locks the row `FOR UPDATE` first; a Macro
computer's harness keeps its agents bound when deleted (the unbind trigger
skips it) so the control plane can delete them after `revoke_hosted_harness`.
Neither its owner (`delete_harness`) nor its own daemon (`delete_self`) may
delete a computer's harness: both get `HarnessError::ComputerHarness` (409);
releasing the computer retires it.
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
  `entity_access` that makes every member a User. A Macro computer's harness
  belongs to the computer's team: its owner and admins are Owners, its other
  members Users, and nobody else, the buyer included once they leave. It takes
  no team access changes or direct shares (`HarnessError::ComputerHarness`,
  and `direct_share::facts` returns none), and the teammate directory lists it
  only to the team's members.
- The SQL function `harness_access_level` is the one rule for a person's level,
  and `harness_can_run` for running agents on it; check the latter wherever
  something runs. A direct grant counts only while its holder shares a team with
  the owner. Never authorize from `Harness.owner` for a computer harness.
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
- Used by: `coding_agent_worker`, `bots` (`HarnessTeamAgents`).

- `authorize_harness(caller, harness_id, HarnessPermission::{View, Use, Manage})` is
  the access boundary for other services' routes: View requires effective
  access; Use requires Owner or User; Manage is the owner, or an owner of a
  team the runtime is shared with (take it out of service). On a computer
  harness Manage is Owner access, meaning the computer team's owner and admins. Provider
  accounts (`domain::account_logins`): `provider_accounts` is one account at an
  `AgentProvider` (only `Claude`; new providers add an `agent_provider` enum value), keyed by the
  provider's id (Claude: harnessd's fingerprint of its setup-token
  credential, which names no account), shared by every
  machine signed in to it. `harness_account_logins` is one sign-in on a
  machine: `record_account_login` (trusted) applies an `AccountLoginChange`
  from harnessd's status, in one transaction: a sign-in on the active login's
  own account only moves its `expires_at`; any other sign-in upserts the
  account, signs out the provider's active login and inserts a new row (its
  signer may be NULL for a sign-in made on the machine itself); a sign-out
  stamps `signed_out_at`, so history stays as signed-out rows. At most one
  active login per provider per machine (partial unique index). `claude_mode`
  is derived (an active `claude` login means `own_account`), never stored.
  The control plane's Claude sign-in
  notices go to the login's signer (`signed_in_by`, NULL once deleted); it
  reads computer harnesses' active logins with `computer_account_logins` and
  stamps the notice it sent with `record_login_notice` (`notice_stage`,
  `notice_expires_at`). Nothing else reads or writes these tables.
- `patch_harness` lets managers change the name and permission bypass while
  preserving computer identity and Claude billing mode.
- Harness rows carry `computer_id` (set only for Macro computers; unique
  among live rows).
- An agent teammate's computer: `HarnessServiceImpl` takes a
  `ComputerTeamAgents` port (hosted_runtimes' `PgComputerAgents`). The usable
  list, the directory and a patch's answer set `team_agent_user_id`, and
  `HarnessTeamAgents::harness_team_agent` (trusted) answers for one harness;
  bots and the session opener refuse such a harness. It stays in the listings,
  where Bring your AI finds it by `computer_id`.

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
  `agent_configs.harness_id` for its agents, as a hard delete's `SET NULL` would,
  except on a Macro computer's harness, whose agents the release deletes.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`
- Skill: `cloud-storage-hexagonal-architecture`

- `HostedPairing.device_secret` redacts formatting and zeroizes on drop; use `expose()` only at enrollment boundaries.

- Pairing and computer ports use the leaf `pairing_id::PairingId` and `computer_id::ComputerId`; unwrap UUIDs only at adapter boundaries.

- New hosted-registration and metadata persistence failures use typed adapter errors with rootcause reports; existing repository callers retain their error contract.

- `pg_harness_repo/hosted_pairing.rs` owns hosted enrollment and computer lookups; `metadata.rs` persists provider account logins.
