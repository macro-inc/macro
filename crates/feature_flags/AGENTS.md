# feature_flags

## What it is

Shared infrastructure for cross-feature rollout gating: async flag loading
for authenticated Macro users or explicit global service contexts; one load returns a stable
`FlagSnapshot`, read synchronously after.

## Start here

- `README.md`: the contract (load semantics, PostHog request/response rules,
  error behavior) — read this before `src/`, which is also the crate doc.
- `src/outbound/posthog.rs`: the real adapter.
- `src/outbound/fake.rs`: the in-memory adapter for tests.

## Scope

- Owns: the `FeatureFlags` and `ServiceFeatureFlags` ports, `FlagSnapshot`/`FlagValue`, and the PostHog
  and fake adapters.
- Not here: which flag name gates which feature — that lives at the call site.

## Boundaries

- Depends on: `macro_user_id`, `macro_env` (the `environment` person property
  every load sends).
- Used by: `agent_harness_service` (agent modes, routine templates),
  `authentication_service` (`enable-outlook`), `document_storage_service`
  (calls, Canvas artifacts), and the `ai_tools`, `agent_harness`,
  `agent_inmem`, `call`, and `scheduled_action` crates. Each composition root
  wires the PostHog adapter with its config's `environment`.

## Recipes

- Add an outbound adapter: `src/domain.rs` (port) → `src/outbound/<name>.rs`
  → `src/outbound.rs`.

## Checks

- `cargo test -p feature_flags`.

## Related

- Rules: `.agents/rules/rust/architecture.md`
