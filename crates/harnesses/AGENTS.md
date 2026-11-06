# harnesses

## What it is

Belongs to agent sessions: registration for user-run agent harnesses
(macrod). Owns device-code pairing (create, approve, claim), the harness
list the settings UI renders, revocation, and the bound-agent listing the
daemon reconciles its webhook feed from. Also registers Macro computers'
harnesses (hosted VMs, `crates/hosted_runtimes`): `create_hosted_pairing`
mints a pairing born approved and owned by the team, idempotent per
`computer_id` (a retry before the claim rotates the device secret and keeps
the pairing id; after it, revokes every old token and creates a fresh approved
pairing for the same harness row and id, preserving agent bindings). Claim
and re-key serialize on the harness row so retired credentials cannot be reissued.
`revoke_hosted_harness(computer_id)` and
`harness_computer(harness_id)` are the control plane's other entry points.
These three take no caller: they are for trusted in-process callers that
already authorized the team admin, never for an HTTP route.

## Start here

- `src/domain/service.rs`: pairing, listing, revocation logic.
- `src/domain/tokens.rs`: harness token minting/verification
  (`constant_time_eq` comparison — don't swap in a non-constant-time check).
- `src/domain/ports.rs` + `src/domain/models.rs`: repo port and harness model.
- `src/inbound/axum_router.rs`: the HTTP surface.
- `src/outbound/pg_harness_repo.rs`: the Postgres adapter.

## Scope

- Owns: harness registration, pairing, and the agent-binding list.
- Not here: running an agent session or the ACP protocol itself →
  `crates/agent_session`, `coding_agent_worker`.

## Boundaries

- Depends on: `harness_id`, `harness_token`, `bot_id`, `macro_authorization`.
- Used by: `coding_agent_worker`.

- `authorize_harness(caller, harness_id, HarnessAccess::{View, Manage})` is
  the access rule for other services' harness routes: view = owner or team
  member, manage = the delete rule. `set_claude_mode` (trusted) records
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
