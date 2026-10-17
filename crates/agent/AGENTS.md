# agent

## What it is

Part of AI: the model-agnostic turn runner every AI surface in the product
builds on — agent sessions, document AI, and background AI features all
run a turn through this crate's loop, with a shared model/speed vocabulary
and usage metering.

## Start here

- `src/agent_loop.rs`: `AgentLoop`/`Session` — runs a turn, dispatches tool
  calls, loops until a final response.
- `src/model/`: provider adapters (`anthropic.rs`, `openai.rs`, `gemini.rs`)
  behind `model/router.rs`, plus `predefined_model.rs`/`speed.rs` (the
  product-facing model/speed vocabulary) and `metering.rs` (usage recording
  hook into `ai_usage`).
- `src/stream.rs`: `StreamPart`/`ChatCompletionStream`, the wire shape
  callers consume.
- `src/completion.rs`: one-shot, non-looping completions (no tools).
- `src/structured_output.rs`: prompted JSON generation with offline schema
  preflight and result validation; external schema references are rejected.

## Scope

- Owns: the turn loop, provider routing/model selection, streaming parts,
  and metering integration.
- Not here: tool definitions and schemas → `ai_toolset`, `ai_tools`; usage
  pricing/billing → `ai_usage`, `ai_billing`.

## Boundaries

- Depends on: `ai_usage` (metering), `ai_toolset` (tool adapter trait),
  `attachment`, `genai_telemetry`, `prompt`, `rig-core`/`rig-agent`.
- Used by: `agent_inmem`, `ai_tools`, `ai_projections` (`agent` feature),
  and most AI-surface crates that run a turn (directly or via `ai_tools`).

## Recipes

- Add a model: `src/model/predefined_model.rs` (enum variant) →
  `src/model/router.rs` (dispatch) → provider adapter in `src/model/` →
  pricing in `ai_usage`.
- Add a stream part / tool-call shape change: `src/stream.rs` → `src/convert.rs`
  (rig message conversion) → `src/accumulator.rs` (accumulation across chunks).

## Checks

- `cargo test -p agent` (`SQLX_OFFLINE` unset).

## Gotchas

- `rig-core`/`rig-agent` are pinned exact versions (not workspace deps);
  bump both together and check `test-utils` feature compatibility.
- `AgentLoop::with_provider_api_key` rekeys only the loop's own model calls
  (native Anthropic/OpenAI); call it after `with_model`. Tools and
  `complete*` still use the deployment's keys.

## Related

- Rules: `.agents/rules/rust/architecture.md` · Skill: `upgrade-model`
