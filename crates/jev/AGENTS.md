# jev

## What it is

Belongs to automations: yes/no classification of arbitrary JSON against a
list of questions, backed by TypeSafe's Jev model, with usage metering built
in — used to gate scheduled-action triggers on a condition.

## Start here

- `src/domain/service.rs`: `JevClassifier` — the metered classification use
  case; wraps a `JevProvider` and records token usage on every call.
- `src/domain/ports.rs`: `JevProvider` / `YesNoClassifier` port traits.
- `src/outbound/typesafe.rs`: the TypeSafe HTTP adapter (feature `outbound`).

## Scope

- Owns: the question/probability value objects, the `MAX_QUESTIONS` guard,
  and metering every classification call through `ai_usage::UsageRecorder`.
- Not here: the TypeSafe API contract itself, or deciding what questions to
  ask — that's the caller's (`scheduled_action`'s trigger-gating logic).

## Boundaries

- Depends on: `ai_usage` (usage metering); `outbound` feature adds
  `macro_env_var`, `reqwest`, `tokio`.
- Used by: `scheduled_action` (gates event triggers on yes/no conditions).

## Checks

- `cargo test -p jev` (`SQLX_OFFLINE` unset).

## Gotchas

- `classify` records usage even when the provider's answer count doesn't
  match the question count — the call was billed regardless of whether the
  response is usable; don't skip metering on a validation failure path.
- Jev has no prompt cache, so every input token reports as uncached.

## Related

- Rules: `.agents/rules/rust/architecture.md` (CS-51/CS-52 hexagonal layering)
