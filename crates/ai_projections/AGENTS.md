# ai_projections

## What it is

Part of AI: materialized, cached AI-generated views of a user's data (for
example a dashboard widget), keyed by a frontend-defined id and
regenerated on demand or when cold.

## Start here

- `src/lib.rs` doc comment: the full lifecycle — upsert-and-read on
  `POST /ai-projections`, async vs. `await: true` materialization,
  `prompt_hash` versioning, push via connection gateway.
- `src/domain/ai_projection_service.rs`: the upsert/read/invalidate logic.
- `src/domain/projection_generator.rs`: the generation port.
- `src/outbound/agent_generator.rs`: the agent-backed generator (behind the
  `agent` feature) — two-phase when `output_schema` is set (tool-enabled
  agent gathers context, then a structured completion distills it).
- `src/worker.rs`: the SQS-polling worker that drains `ai_projection_queue`.

## Scope

- Owns: projection definitions, per-user cached instances, generation
  orchestration (inline or queued), and push notification on completion.
- Not here: the agent turn loop itself → `agent`; tool definitions →
  `ai_tools`/`ai_toolset`.

## Boundaries

- Depends on: `models_ai_projection`, and (behind `agent`) `ai_tools`,
  `ai_toolset`, `agent`, `ai_usage`.
- Used by: `document_cognition_service` (inbound/outbound/agent) and
  `ai_projections_refresh_handler` (the scheduled refresh lambda).

## Recipes

- Add a projection type: define its prompt/schema at the frontend-defined
  id → `src/domain/model.rs` if a new output shape → `src/outbound/agent_generator.rs`
  if it needs the two-phase schema path.

## Checks

- `cargo test -p ai_projections` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
