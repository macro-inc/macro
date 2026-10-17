# team_provider_keys

## What it is

Part of AI chat: a team's own Anthropic and OpenAI API keys. Team admins
register them; members' in-memory AI chat (`agent_inmem`) can run turns on
them instead of Macro's allowance. See the crate doc in `src/lib.rs`.

## Start here

- `src/domain/service.rs`: the policy — admins register/remove
  (`EntityAccessReceipt<AdminTeamRole>`), members list
  (`<MemberTeamRole>`), and `TeamModelKeys` for the chat runtime.
- `src/domain/models.rs`: `ModelProvider` and `ProviderApiKey` (prefix rules).
- `src/outbound/pg.rs`: rows in `cursor_configs` with a `team_id`.

## Scope

- Owns: team rows of `cursor_configs` (`provider` = `anthropic`/`openai`).
- Not here: users' Cursor rows → `crates/cursor_api_key`; routing a turn on a
  key → `crates/agent` (`AgentLoop::with_provider_key`); deciding when a turn
  uses one → `crates/agent_inmem` (`domain/funding.rs`).

## Boundaries

- Depends on: `cursor_api_key` (the `KmsCiphertexts` seam and its CMK),
  `entity_access` (team receipts).
- Used by: `authentication_service` (settings routes),
  `agent_harness_service` (decrypt-only, for turns).

## Checks

- `cargo test -p team_provider_keys` (`SQLX_OFFLINE` unset).

## Gotchas

- A member's lookup joins `team_user` on every turn: never cache a decrypted
  key or a membership answer across turns.
- Prefixes are enforced twice: `ProviderApiKey::parse` and the
  `cursor_configs_key_prefix` check. Change both together.
- Deleting a row does not revoke the key at the provider.

## Related

- Rules: `.agents/rules/rust/security.md`, `.agents/rules/rust/db.md`
