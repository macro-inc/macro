# agent_api_keys

## What it is

Part of agents: an agent's own Anthropic or OpenAI API key. An in-memory
agent on an Anthropic or OpenAI model can have one; while it fits, every turn
of the agent runs on it instead of Macro's allowance. See the crate doc in
`src/lib.rs`.

## Start here

- `src/domain/service.rs`: the policy — which agents take a key, the paid-plan
  check on save and on every turn, and `AgentKeys` for the chat runtime.
- `src/domain/models.rs`: `ModelProvider`, `ProviderApiKey` (prefix rules),
  `KeyedAgent` (the agent a caller authorized).
- `src/outbound/pg.rs`: `agent_api_keys`, joined to `bots` and
  `agent_configs` so a turn sees the agent as configured now.
- `src/outbound/plans.rs`: `KeyPlans` over ai_billing's entitlements.

## Scope

- Owns: `agent_api_keys`.
- Not here: who may change an agent → `crates/bots` (`BotService`); routing a
  turn's model calls on a key → `crates/agent` (`AgentLoop::with_provider_api_key`);
  deciding a turn runs on one → `crates/agent_inmem`.

## Boundaries

- Depends on: `cursor_api_key` (the `KmsCiphertexts` seam and its CMK),
  `ai_billing` (plans).
- Used by: `authentication_service` (save/remove routes, encrypts),
  `agent_harness_service` (decrypt-only, for turns).

## Checks

- `cargo test -p agent_api_keys` (`SQLX_OFFLINE` unset).

## Gotchas

- Never cache a decrypted key or a plan answer across turns: `usable_key` is
  called per turn.
- A key counts only while the agent is in-memory, its model's provider is the
  key's, and its owner's plan includes keys. Otherwise the agent runs on Macro
  usage and the key stays stored (shown and removable).
- Prefixes are enforced twice: `ProviderApiKey::parse` and the
  `agent_api_keys_key_prefix` check. Change both together.
- Bots are soft-deleted, so the `ON DELETE CASCADE` rarely fires; `stored`
  ignores deleted agents.
- Deleting a key does not revoke it at the provider.

## Related

- Rules: `.agents/rules/rust/security.md`, `.agents/rules/rust/db.md`
