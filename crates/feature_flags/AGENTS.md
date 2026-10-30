# feature_flags

## What it is

Shared infrastructure for cross-feature rollout gating: async flag loading
for the authenticated Macro user, where one load returns a stable
`FlagSnapshot`, read synchronously after.

## Start here

- `README.md`: the contract (load semantics, PostHog request/response rules,
  error behavior) — read this before `src/`, which is also the crate doc.
- `src/outbound/posthog.rs`: the real adapter.
- `src/outbound/fake.rs`: the in-memory adapter for tests.

## Scope

- Owns: the `FeatureFlags` port, `FlagSnapshot`/`FlagValue`, and the PostHog
  and fake adapters.
- Not here: which flag name gates which feature — that lives at the call site.

## Boundaries

- Depends on: `macro_user_id`.
- Used by: nothing yet (landed in #7985); a composition root wires an adapter
  in before any caller depends on this crate.

## Recipes

- Add an outbound adapter: `src/domain.rs` (port) → `src/outbound/<name>.rs`
  → `src/outbound.rs`.

## Checks

- `cargo test -p feature_flags`.

## Related

- Rules: `.agents/rules/rust/architecture.md`
