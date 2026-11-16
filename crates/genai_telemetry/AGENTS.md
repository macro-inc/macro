# genai_telemetry

## What it is

Supports the agent sessions feature's observability: adds `gen_ai.*`
content/tool-definition attributes that Datadog LLM Observability needs on
top of the structural spans `rig` already emits, shared by the AI toolset and
agent loop.

## Start here

- `src/lib.rs`: read the crate doc first — it explains exactly what this adds
  (content, tool definitions, session id) and why (`tracing` can't add fields
  to spans another crate opened).
- `src/content.rs`: `ContentPolicy`/`Limits` — whether/how much content capture
  is allowed, and the bounding that keeps a 12-turn conversation from
  re-sending itself on every span. Explicit `modelMedia` envelopes replace PNG
  data with byte-count/source metadata before capture, including nested tool
  results; inline pixels stay excluded even when content capture is enabled.
- `src/span.rs`: `GenAiSpanExt`, the attribute setters that write to an
  already-open span.
- `src/messages.rs`: builders for the semconv JSON message/tool-definition shapes.

## Scope

- Owns: `gen_ai.*` attribute names/values, content bounding, the setters
  that attach them to spans opened elsewhere, and `provider_account`: the
  classifier and `ai provider account unavailable` log for provider responses
  that mean Macro's account is suspended or out of credit (read by
  `infra/stacks/monitoring/monitors/ai-providers.ts`).
- Not here: the spans themselves (`invoke_agent`, `chat`, `execute_tool`) —
  those come from `rig`.

## Boundaries

- Depends on: `strum`, `macro_env_var` (reads `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`).
- Used by: `agent`, `agent_inmem`, `agent_session`, `ai_toolset`; for
  `provider_account`, also every crate with its own provider client
  (`anthropic`, `dictation`, `embedding`, `image_generation`, `task_dedup`,
  `agent_harness_service`).

`propagation::link` connects delayed outbox delivery to each producer's span
without replacing the delivery worker's own parent.

## Checks

- `cargo test -p genai_telemetry`.

## Related

- Rules: `.agents/rules/observability.md`
