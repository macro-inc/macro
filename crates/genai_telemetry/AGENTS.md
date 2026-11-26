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
  `withhold_content(work)` runs work under the disabled policy whatever the
  switch says (a task-local: `ContentPolicy::current` is the disabled policy
  there, and `agent`'s `GenAiContext` checks the scope at each record, so a
  context built before the scope withholds too). A session's projector runs
  in its own task and follows the prompt's `withhold_content` marker
  instead. A task spawned from withheld work carries it with
  `withhold_content_if(content_withheld(), fut)`.
  Error events inside the scope say only what kind of failure it was, since
  a tool's error or serde's refusal can quote the call: `ai_toolset`'s
  `log_failure`, `agent`'s `log_tool_error`, `mcp_toolset`'s `call_tool`, and
  the harness's `invalid_arguments` for the refusal rmcp logs, check
  `content_withheld()` first.
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

- Depends on: `strum`, `macro_env_var` (reads `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`), `tokio` (the task-local behind `withhold_content`).
- Used by: `agent`, `agent_inmem`, `agent_session`, `ai_toolset`, `mcp_toolset`; for
  `provider_account`, also every crate with its own provider client
  (`anthropic`, `dictation`, `embedding`, `image_generation`, `task_dedup`,
  `agent_harness_service`).

`propagation::inject_mcp` / `set_parent_from_mcp` carry W3C context in an
MCP request's `_meta` under SEP-414's `traceparent` / `tracestate` keys (the
in-process agent's calls to the harness's internal MCP). A request sent inside
`withhold_content` also carries `macro.dev/withhold-content`, and the server
runs the tool inside the scope when `mcp_withholds_content` says so: a caller
can only ask for less on traces.

`propagation::link` connects delayed outbox delivery to each producer's span
without replacing the delivery worker's own parent.

## Checks

- `cargo test -p genai_telemetry`.

## Related

- Rules: `.agents/rules/observability.md`
