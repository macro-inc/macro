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
  re-sending itself on every span.
- `src/span.rs`: `GenAiSpanExt`, the attribute setters that write to an
  already-open span.
- `src/messages.rs`: builders for the semconv JSON message/tool-definition shapes.

## Scope

- Owns: `gen_ai.*` attribute names/values, content bounding, and the setters
  that attach them to spans opened elsewhere.
- Not here: the spans themselves (`invoke_agent`, `chat`, `execute_tool`) —
  those come from `rig`.

## Boundaries

- Depends on: `macro_env_var` (reads `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`).
- Used by: `agent`, `agent_inmem`, `agent_session`, `ai_toolset`.

## Checks

- `cargo test -p genai_telemetry`.

## Related

- Rules: `.agents/rules/observability.md`
