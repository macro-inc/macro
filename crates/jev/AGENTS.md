# jev

## What it is

Belongs to automations: yes/no classification of arbitrary JSON against a
list of questions, backed by a System One decision model (TypeSafe's Jev or
Cloudflare Workers AI's Clef Flash), with usage metering built
in — used to gate scheduled-action triggers, to serve authenticated
named decisions through cognition, and to pick Chat or Code for the agent
composer's Auto mode.

## Start here

- `src/domain/service.rs`: `JevClassifier` — the metered classification use
  case; wraps a `JevProvider` and records token usage on every call.
- `src/domain/decisions.rs`: named decision admission, capacity, deadline and
  cancellation-safe metering (`decisions` feature).
- `src/domain/ports.rs`: `JevProvider` / `YesNoClassifier` port traits.
- `src/outbound/system_one.rs`: `SystemOneJev`, the HTTP adapter for TypeSafe
  and Cloudflare Workers AI (feature `outbound`).

## Scope

- Owns: the question/probability value objects, the `MAX_QUESTIONS` guard,
  and metering every classification call through `ai_usage::UsageRecorder`.
- Not here: the providers' API contracts themselves, or deciding what questions to
  ask — that belongs to the caller (trigger logic or an API request).

## Boundaries

- Depends on: `ai_usage` (usage metering); `outbound` feature adds
  `macro_env_var`, `reqwest`, `tokio`.
- Used by: `scheduled_action` (trigger conditions),
  `document_cognition_service` (the `/decisions` endpoint), `agent_harness`
  (Auto mode choice, Clef Flash), `agent_session` (whether to retitle a
  session after a turn, TypeSafe).

## Checks

- `cargo test -p jev --all-features` (`SQLX_OFFLINE` unset).

## Gotchas

- `classify` records usage even when the provider's answer count doesn't
  match the question count — the call was billed regardless of whether the
  response is usable; don't skip metering on a validation failure path.
- System One models have no prompt cache, so every input token reports as
  uncached.
- Cloudflare wraps answers in `{"result": ...}`; TypeSafe returns them bare.

## Related

- Rules: `.agents/rules/rust/architecture.md` (CS-51/CS-52 hexagonal layering)
