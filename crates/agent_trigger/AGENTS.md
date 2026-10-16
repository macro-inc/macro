# agent_trigger

## What it is

Part of agent sessions: decides whether a posted channel message, task
assignment, or project assignment should start an agent session, and
assembles the prompt context (thread history, people, discussion) for the
session that results.

## Start here

- `src/domain/service.rs`: orchestration for evaluating one posted message
  — mention detection, admission, and dispatch.
- `src/domain/sources.rs`: the trigger sources (explicit mention, implicit
  reply, task/project assignment).
- `src/domain/context.rs`: structured context assembled for the agent
  prompt (thread history, people, discussion).
- `src/domain/task_assignment.rs` / `src/domain/project_assignment.rs`:
  non-message trigger paths.
- `src/outbound/fast_model_judge.rs`: the Haiku-class implicit-trigger
  classifier.

## Scope

- Owns: trigger detection/admission and prompt-context assembly for all
  trigger sources.
- Not here: running the agent session once triggered → `agent_harness`;
  session state → `agent_session`.

## Boundaries

- Depends on: `agent_session`, `ai_billing` (admission, `admission`
  feature), `messages`, `bots`.
- Used by: `agent_trigger_service` (its primary host) and `agent_harness`
  (routes triggers it receives via `agent_harness`'s `trigger_router`).

## Recipes

- Add a trigger source: `src/domain/sources.rs` → `src/domain/service.rs`
  (admission + dispatch) → `src/domain/context.rs` if it needs new context.
- Change implicit-reply detection: `src/outbound/fast_model_judge.rs` →
  `src/outbound/lexical_explicit_reply_extractor.rs`.

## Checks

- `cargo test -p agent_trigger` (`SQLX_OFFLINE` unset).

## Gotchas

- A new trigger variant must also be taught to `crates/webhook` ingestion
  and the SSE fan-out, or it will be silently dropped end to end.

## Related

- Rules: `.agents/rules/rust/architecture.md`
