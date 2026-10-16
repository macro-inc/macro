# teams

## What it is

Part of account/workspace management — team membership, invites, roles,
CRM/analytics settings, and the `macro.teams` lifecycle event producer that
other features (billing, CRM) subscribe to. See `README.md` for the full
event contract (schema, sanitization, delivery semantics).

## Start here

- `src/domain/team_service.rs`: the main service — creation, invites,
  membership, role changes, auto-join-domain toggle.
- `src/domain/owned_entity_cleanup.rs` + `open_seat_release.rs`: account/team
  deletion side effects (owned-entity transfer, seat release).
- `src/inbound/axum_router.rs` / `src/inbound/toolset.rs`: HTTP routes and AI
  tool surface.
- `src/outbound/team_repo.rs`: the Postgres repository.

## Scope

- Owns: the `"Team"` table's lifecycle, membership, invites, and the
  `macro.teams` Kafka producer.
- Not here: billing/seat pricing logic → `crates/ai_billing` (consumes this
  crate); CRM company/contact sync → `crates/crm` (this crate only enqueues).

## Boundaries

- Depends on: `entity_access`, `channels` (feature `backfill_binary`),
  `analytics_client`, `ai_toolset` (feature `ai_tools`).
- Used by: `services/authentication_service`, `services/document_storage_service`,
  `services/calendar_service`, `services/agent_harness_service`,
  `services/mcp_service`, `services/scheduled_action`, `crates/ai_tools`,
  `crates/ai_billing`, `crates/calendar_scheduling`.

## Recipes

- Add a team mutation: `src/domain/team_service.rs` → `src/domain/events.rs`
  (new event variant, if it should publish) → `src/outbound/team_repo.rs` →
  `src/inbound/axum_router.rs`.
- Repair missed teammate DMs: `just crates/teams/backfill_teammate_dms_local`
  (see README's "Delivery semantics" for when this is needed).

## Checks

- `cargo test -p teams` (`SQLX_OFFLINE` unset).
- After query changes: `nix develop --command just prepare_db` from the repo root
  inside Nix.

## Related

- Docs: `crates/teams/README.md` · Rules: `.agents/rules/rust/db.md`
