# Derived metrics: Datadog to Mimir

Generated from `modules/derived-metrics/*.nix` by `nix run .#render`; edit those.
To use the mapping from Nix, import `spans.nix`: each entry of its `metrics` has
the Datadog `name`, the Mimir `metric`, its `kind` and `labels` (Datadog tag to
Mimir label).

Rules:

- Dots become underscores, in metric names and in tags. `env` is
  `deployment_environment`; tag values are unchanged (Datadog lowercases them,
  Mimir doesn't). A span without the tag has no such label (Datadog: `N/A`).
- Durations (`@duration`) are in seconds and end in `_seconds`; a Datadog
  threshold on one is in nanoseconds. Fields that were already in milliseconds
  or bytes stay so.
- `tool` is a plain name or `other`: some agent harnesses put a
  whole command in it, which Datadog keeps. `name: arguments` becomes `name`.
- `job="derived-metrics"` and `instance` (which of the two replicas counted) are
  on every series: always aggregate them away.

## Translating a query

A series holds one sample per 30 s in which something happened: what happened
in those 30 s (OpenTelemetry delta temporality). Windows are summed with
`sum_over_time`. `rate` and `increase` expect counters and give wrong numbers.

| Datadog | PromQL |
| --- | --- |
| `sum:COUNT{env:prod} by {tool}.as_count()` over 1h | `sum by (tool) (sum_over_time(COUNT{deployment_environment="prod"}[1h]))` |
| `count:DIST{...}` over 1h | `histogram_count(sum(sum_over_time(DIST{...}[1h])))` |
| `sum:DIST{...}` over 1h | `histogram_sum(sum(sum_over_time(DIST{...}[1h])))` |
| `avg:DIST{...}` over 1h | `histogram_avg(sum(sum_over_time(DIST{...}[1h])))` |
| `p95:DIST{...} by {model}` over 1h | `histogram_quantile(0.95, sum by (model) (sum_over_time(DIST{...}[1h])))` |
| `max:DIST{...}` | `histogram_quantile(1, ...)`, within a bucket |

Distributions are native histograms: no `_bucket`, `_sum` or `_count` series.
Counts, sums and averages are exact; quantiles are within a bucket (a few
percent; Datadog's sketches are within 1 %).
Nothing happening means no sample: an ungrouped query that has to give zero needs
`or vector(0)`; a grouped one has no series for a group where nothing happened.

Metrics of production services need those services to send to Grafana: until one
does, its metrics have no `deployment_environment="prod"`.

## From spans

| Datadog | Mimir | Kind | Unit | Labels |
| --- | --- | --- | --- | --- |
| `macro.agent.chat.cache_read_tokens` | `macro_agent_chat_cache_read_tokens` | distribution |  | `env` → `deployment_environment`, `provider` |
| `macro.agent.chat.cache_write_tokens` | `macro_agent_chat_cache_write_tokens` | distribution |  | `env` → `deployment_environment`, `provider` |
| `macro.agent.chat.input_tokens` | `macro_agent_chat_input_tokens` | distribution |  | `env` → `deployment_environment`, `provider` |
| `macro.agent.chat.prompt.connected_integrations.bytes` | `macro_agent_chat_prompt_connected_integrations_bytes` | distribution |  | `env` → `deployment_environment`, `provider` |
| `macro.agent.chat.prompt.history.bytes` | `macro_agent_chat_prompt_history_bytes` | distribution |  | `env` → `deployment_environment`, `provider` |
| `macro.agent.chat.prompt.identity.bytes` | `macro_agent_chat_prompt_identity_bytes` | distribution |  | `env` → `deployment_environment`, `provider` |
| `macro.agent.chat.prompt.macro_prompt.bytes` | `macro_agent_chat_prompt_macro_prompt_bytes` | distribution |  | `env` → `deployment_environment`, `provider` |
| `macro.agent.chat.prompt.memory.bytes` | `macro_agent_chat_prompt_memory_bytes` | distribution |  | `env` → `deployment_environment`, `provider` |
| `macro.agent.chat.prompt.model_id.bytes` | `macro_agent_chat_prompt_model_id_bytes` | distribution |  | `env` → `deployment_environment`, `provider` |
| `macro.agent.chat.prompt.opener_note.bytes` | `macro_agent_chat_prompt_opener_note_bytes` | distribution |  | `env` → `deployment_environment`, `provider` |
| `macro.agent.chat.prompt.preamble.bytes` | `macro_agent_chat_prompt_preamble_bytes` | distribution |  | `env` → `deployment_environment`, `provider` |
| `macro.agent.chat.prompt.sdk_docs.bytes` | `macro_agent_chat_prompt_sdk_docs_bytes` | distribution |  | `env` → `deployment_environment`, `provider` |
| `macro.agent.chat.prompt.session_instructions.bytes` | `macro_agent_chat_prompt_session_instructions_bytes` | distribution |  | `env` → `deployment_environment`, `provider` |
| `macro.agent.chat.prompt.session_note.bytes` | `macro_agent_chat_prompt_session_note_bytes` | distribution |  | `env` → `deployment_environment`, `provider` |
| `macro.agent.chat.prompt.tool_results.bytes` | `macro_agent_chat_prompt_tool_results_bytes` | distribution |  | `env` → `deployment_environment`, `provider` |
| `macro.agent.chat.prompt.tools.eager.bytes` | `macro_agent_chat_prompt_tools_eager_bytes` | distribution |  | `env` → `deployment_environment`, `provider` |
| `macro.agent.chat.prompt.tools.loaded.bytes` | `macro_agent_chat_prompt_tools_loaded_bytes` | distribution |  | `env` → `deployment_environment`, `provider` |
| `macro.agent.tool.calls` | `macro_agent_tool_calls` | count |  | `env` → `deployment_environment`, `tool` |
| `macro.agent.tool.errors` | `macro_agent_tool_errors` | count |  | `env` → `deployment_environment`, `tool` |
| `macro.agent.tool.result_bytes` | `macro_agent_tool_result_bytes` | distribution |  | `env` → `deployment_environment`, `tool` |
| `macro.agent.tool.results_cut` | `macro_agent_tool_results_cut` | count |  | `env` → `deployment_environment`, `tool` |
| `macro.agent.turn.code_executions` | `macro_agent_turn_code_executions` | distribution |  | `env` → `deployment_environment` |
| `macro.agent.turn.code_failures` | `macro_agent_turn_code_failures` | distribution |  | `env` → `deployment_environment` |
| `macro.agent.turn.compaction_wait_ms` | `macro_agent_turn_compaction_wait_ms` | distribution |  | `env` → `deployment_environment` |
| `macro.agent.turn.duration` | `macro_agent_turn_duration_seconds` | distribution | seconds, not nanoseconds | `env` → `deployment_environment`, `model` |
| `macro.agent.turn.model_calls` | `macro_agent_turn_model_calls` | distribution |  | `env` → `deployment_environment`, `model` |
| `macro.agent_harness.runtime_reattach` | `macro_agent_harness_runtime_reattach` | count |  | `env` → `deployment_environment`, `harness` |
| `macro.agent_harness.runtime_reattach.eager` | `macro_agent_harness_runtime_reattach_eager` | distribution |  | `env` → `deployment_environment`, `harness` |
| `macro.agent_harness.runtime_reattach.failures` | `macro_agent_harness_runtime_reattach_failures` | distribution |  | `env` → `deployment_environment`, `harness` |
| `macro.agent_harness.runtime_reattach.lazy` | `macro_agent_harness_runtime_reattach_lazy` | distribution |  | `env` → `deployment_environment`, `harness` |
| `macro.agent_harness.runtime_reattach.sessions` | `macro_agent_harness_runtime_reattach_sessions` | distribution |  | `env` → `deployment_environment`, `harness` |
| `macro.agent_harness.runtime_reattach.skipped` | `macro_agent_harness_runtime_reattach_skipped` | distribution |  | `env` → `deployment_environment`, `harness` |
| `macro.ai.editing.provider_account_unavailable` | `macro_ai_editing_provider_account_unavailable` | count |  | `env` → `deployment_environment`, `provider`, `reason` |
| `macro.firecracker.restore.duration` | `macro_firecracker_restore_duration_seconds` | distribution | seconds, not nanoseconds | `env` → `deployment_environment`, `host`, `source` |
| `macro.outlook.graph_request` | `macro_outlook_graph_request_seconds` | distribution | seconds, not nanoseconds | `env` → `deployment_environment`, `http.status_code` → `http_status_code`, `outlook.throttle_origin` → `outlook_throttle_origin` |
| `macro.outlook.notification_lag` | `macro_outlook_notification_lag` | distribution |  | `env` → `deployment_environment`, `outlook.outcome` → `outlook_outcome` |
| `macro.outlook.sync` | `macro_outlook_sync` | count |  | `env` → `deployment_environment`, `outlook.defer_reason` → `outlook_defer_reason`, `outlook.outcome` → `outlook_outcome`, `resource_name` |
| `macro.outlook.token.acquire` | `macro_outlook_token_acquire` | count |  | `env` → `deployment_environment`, `http.status_code` → `http_status_code`, `outlook.outcome` → `outlook_outcome`, `outlook.token_cache` → `outlook_token_cache` |
| `macro.web.flow.blocking_ms` | `macro_web_flow_blocking_ms` | distribution |  | `app.platform` → `app_platform`, `env` → `deployment_environment`, `flow.kind` → `flow_kind`, `os.type` → `os_type`, `resource_name` |
| `macro.web.flow.elapsed_ms` | `macro_web_flow_elapsed_ms` | distribution |  | `app.platform` → `app_platform`, `env` → `deployment_environment`, `flow.kind` → `flow_kind`, `os.type` → `os_type`, `resource_name`, `route.id` → `route_id`, `ui.outcome` → `ui_outcome` |
| `macro.web.graphql.body_ms` | `macro_web_graphql_body_ms` | distribution |  | `app.platform` → `app_platform`, `env` → `deployment_environment`, `os.type` → `os_type`, `resource_name` |
| `macro.web.http.body_ms` | `macro_web_http_body_ms` | distribution |  | `app.platform` → `app_platform`, `env` → `deployment_environment`, `os.type` → `os_type`, `resource_name` |
| `macro.web.phase.duration` | `macro_web_phase_duration_seconds` | distribution | seconds, not nanoseconds | `app.platform` → `app_platform`, `env` → `deployment_environment`, `flow.root` → `flow_root`, `os.type` → `os_type`, `resource_name` |
| `macro.web.runtime.blocking_ms` | `macro_web_runtime_blocking_ms` | distribution |  | `app.platform` → `app_platform`, `app.runtime` → `app_runtime`, `env` → `deployment_environment`, `os.type` → `os_type`, `resource_name` |
| `macro.web.runtime.js_heap_used_bytes` | `macro_web_runtime_js_heap_used_bytes` | distribution |  | `app.platform` → `app_platform`, `app.runtime` → `app_runtime`, `env` → `deployment_environment`, `os.type` → `os_type`, `resource_name` |
| `macro.web.typing.event_duration_p95_ms` | `macro_web_typing_event_duration_p95_ms` | distribution |  | `app.platform` → `app_platform`, `env` → `deployment_environment`, `os.type` → `os_type`, `resource_name`, `typing.surface` → `typing_surface` |
| `macro.web.view.duration` | `macro_web_view_duration_seconds` | distribution | seconds, not nanoseconds | `app.platform` → `app_platform`, `env` → `deployment_environment`, `os.type` → `os_type`, `resource_name`, `route.id` → `route_id` |
