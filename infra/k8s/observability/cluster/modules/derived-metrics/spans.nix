# Datadog's span-based metrics, as computed here. Plain data, so whatever ports
# a Datadog monitor or dashboard can import it: `name` is the Datadog metric,
# `metric` what it is called in Mimir, `labels` maps its Datadog tags.
#
# - `select`: an entry of `selections`, which spans it is computed from.
# - `where`: further OTTL conditions, all of which must hold.
# - `value`: null counts spans; `"duration"` is the span's duration; anything
#   else is a numeric attribute (a number, or a string holding one). Both of
#   the latter are distributions: native histograms.
# - `tags`: Datadog tag -> the span attributes it is read from, first present
#   wins, the resource's after the span's own (Datadog flattens both). Every
#   metric also has Datadog's `env`.
#
# The definitions are those of infra/stacks/monitoring. Change both together
# while Datadog still has them.
{ lib }:
let
  ottl = import ./ottl.nix;
  inherit (ottl)
    attr
    present
    is
    isNot
    service
    same
    ;
  named = name: ''name == "${name}"'';
  notFailed = "status.code != STATUS_CODE_ERROR";
  failed = "status.code == STATUS_CODE_ERROR";

  # Cheapest condition first: every span that reaches ingest is tested.
  selections = {
    agent_turn = [
      (named "agent.turn")
      (service "agent-harness-service")
    ];
    agent_prompt = [
      (named "agent.acp.prompt")
      (service "agent-harness-service")
    ];
    agent_chat = [
      (named "chat_streaming")
      (service "agent-harness-service")
    ];
    # One span per session tool call: a tool reached through MCP opens a second
    # `execute_tool` span inside it without the conversation id.
    agent_tool = [
      (is "gen_ai.operation.name" "execute_tool")
      (present "gen_ai.conversation.id")
      (service "agent-harness-service")
    ];
    runtime_reattach = [
      (named "agent.runtime.reattach")
      (service "agent-harness-service")
    ];
    provider_account_unavailable = [ (named "ai.provider_account_unavailable") ];
    firecracker_launch = [
      (named "firecracker_host.launch")
      (service "firecracker-host")
    ];
    outlook_sync = [ ''IsMatch(name, "^outlook[.]sync[.]")'' ];
    outlook_graph = [ (present "outlook.throttle_origin") ];
    outlook_token = [ (present "outlook.token_cache") ];
    # A model call by any service, inside an agent session or not.
    model_call = [ (is "gen_ai.operation.name" "chat") ];
    web_perf = [
      (is "macro.sampling.class" "perf")
      (service "web-app")
    ];
  };

  statusCode."http.status_code" = [
    "http.response.status_code"
    "http.status_code"
  ];

  # Datadog's resource name of a span: its HTTP method when it has one.
  # `name` here is the span's name, not an attribute.
  resourceName."resource_name" = [
    "http.request.method"
    "name"
  ];
  webTags = resourceName // same "app.platform" // same "os.type";
  web = extra: args: { select = "web_perf"; } // args // { tags = webTags // extra; };

  turn = value: {
    select = "agent_turn";
    inherit value;
    tags.model = [ "agent.model" ];
  };
  prompt = value: {
    select = "agent_prompt";
    inherit value;
  };
  chat = value: {
    select = "agent_chat";
    inherit value;
    tags.provider = [ "gen_ai.provider.name" ];
  };
  # Datadog's LLM Observability metrics (`ml_obs.*`), for model calls only: its
  # `span_kind:llm`.
  modelCall =
    args:
    {
      select = "model_call";
      tags = {
        service = [ "service.name" ];
        model_name = [
          "gen_ai.response.model"
          "gen_ai.request.model"
        ];
        model_provider = [ "gen_ai.provider.name" ];
      };
    }
    // args;
  tool =
    args:
    {
      select = "agent_tool";
      tags.tool = [ "gen_ai.tool.name" ];
    }
    // args;
  reattach = value: {
    select = "runtime_reattach";
    inherit value;
    tags = same "harness";
  };

  promptParts = [
    "preamble"
    "macro_prompt"
    "identity"
    "session_instructions"
    "session_note"
    "opener_note"
    "memory"
    "model_id"
    "connected_integrations"
    "sdk_docs"
    "tools.eager"
    "tools.loaded"
    "history"
    "tool_results"
  ];

  definitions = {
    "macro.agent.turn.duration" = turn "duration";
    "macro.agent.turn.model_calls" = turn "agent.stream.model_calls";

    "macro.agent.chat.input_tokens" = chat "gen_ai.usage.input_tokens";
    "macro.agent.chat.cache_read_tokens" = chat "gen_ai.usage.cache_read.input_tokens";
    "macro.agent.chat.cache_write_tokens" = chat "gen_ai.usage.cache_creation.input_tokens";

    "ml_obs.span.duration" = modelCall { value = "duration"; };
    "ml_obs.span.error" = modelCall { where = [ failed ]; };
    "ml_obs.span.llm.input.tokens" = modelCall { value = "gen_ai.usage.input_tokens"; };
    "ml_obs.span.llm.input.cache_read.tokens" = modelCall {
      value = "gen_ai.usage.cache_read.input_tokens";
    };
    "ml_obs.span.llm.input.cache_write.tokens" = modelCall {
      value = "gen_ai.usage.cache_creation.input_tokens";
    };
    "ml_obs.span.llm.output.tokens" = modelCall { value = "gen_ai.usage.output_tokens"; };
    # Not in Datadog.
    "macro.genai.chat.time_to_first_chunk_ms" = modelCall {
      value = "macro.genai.chat.time_to_first_chunk_ms";
    };

    "macro.agent.tool.calls" = tool { };
    "macro.agent.tool.errors" = tool { where = [ failed ]; };
    "macro.agent.tool.result_bytes" = tool { value = "macro.genai.tool.result_bytes"; };
    "macro.agent.tool.results_cut" = tool {
      where = [
        "(${attr "macro.genai.tool.result_cut"} == true or ${is "macro.genai.tool.result_cut" "true"})"
      ];
    };

    "macro.agent.turn.code_executions" = prompt "agent.turn.code_executions";
    "macro.agent.turn.code_failures" = prompt "agent.turn.code_failures";
    "macro.agent.turn.compaction_wait_ms" = prompt "agent.turn.compaction_wait_ms";

    "macro.ai.editing.provider_account_unavailable" = {
      select = "provider_account_unavailable";
      tags = {
        provider = [ "ai.provider" ];
        reason = [ "ai.account_unavailable" ];
      };
    };

    "macro.firecracker.restore.duration" = {
      select = "firecracker_launch";
      where = [
        "(${is "source" "golden"} or ${is "source" "hibernation"})"
        notFailed
      ];
      value = "duration";
      tags = same "source" // {
        host = [ "host.name" ];
      };
    };

    "macro.agent_harness.runtime_reattach" = reattach null;
    "macro.agent_harness.runtime_reattach.sessions" = reattach "agent.runtime.reattach_sessions";
    "macro.agent_harness.runtime_reattach.eager" = reattach "agent.runtime.reattach_eager";
    "macro.agent_harness.runtime_reattach.lazy" = reattach "agent.runtime.reattach_lazy";
    "macro.agent_harness.runtime_reattach.skipped" = reattach "agent.runtime.reattach_skipped";
    "macro.agent_harness.runtime_reattach.failures" = reattach "agent.runtime.reattach_failures";

    "macro.outlook.sync" = {
      select = "outlook_sync";
      tags = resourceName // same "outlook.outcome" // same "outlook.defer_reason";
    };
    "macro.outlook.notification_lag" = {
      select = "outlook_sync";
      where = [ (named "outlook.sync.reconcile") ];
      value = "outlook.notification_lag_ms";
      tags = same "outlook.outcome";
    };
    "macro.outlook.graph_request" = {
      select = "outlook_graph";
      value = "duration";
      tags = statusCode // same "outlook.throttle_origin";
    };
    "macro.outlook.token.acquire" = {
      select = "outlook_token";
      tags = statusCode // same "outlook.outcome" // same "outlook.token_cache";
    };

    "macro.web.flow.elapsed_ms" = web (same "flow.kind" // same "route.id" // same "ui.outcome") {
      where = [ (present "flow.kind") ];
      value = "ui.elapsed_ms";
    };
    "macro.web.flow.blocking_ms" = web (same "flow.kind") {
      where = [
        (present "flow.kind")
        (is "ui.outcome" "success")
      ];
      value = "ui.long_animation_frame_blocking_ms";
    };
    "macro.web.view.duration" = web (same "route.id") {
      where = [
        ''IsMatch(name, "^view[.]")''
        (isNot "flow.outcome" "cancelled")
        (isNot "ui.outcome" "cancelled")
        (isNot "ui.outcome" "hidden")
        (isNot "ui.outcome" "timeout")
      ];
      value = "duration";
    };
    "macro.web.phase.duration" = web (same "flow.root") {
      where = [
        (present "flow.root")
        (is "flow.outcome" "success")
      ];
      value = "duration";
    };
    "macro.web.http.body_ms" = web { } {
      where = [ (is "http.body_outcome" "complete") ];
      value = "http.body_ms";
    };
    "macro.web.graphql.body_ms" = web { } {
      where = [
        (named "graphql.transport")
        (is "graphql.body_outcome" "complete")
      ];
      value = "graphql.body_ms";
    };
    "macro.web.runtime.js_heap_used_bytes" = web (same "app.runtime") {
      where = [ (named "app.runtime.sample") ];
      value = "macro.memory.js_heap.used_bytes";
    };
    "macro.web.runtime.blocking_ms" = web (same "app.runtime") {
      where = [ (named "app.runtime.sample") ];
      value = "runtime.long_animation_frame.blocking_ms";
    };
    "macro.web.typing.event_duration_p95_ms" = web (same "typing.surface") {
      where = [ (named "input.typing_burst") ];
      value = "typing.event_duration_p95_ms";
    };
  }
  // lib.listToAttrs (
    map (
      part:
      lib.nameValuePair "macro.agent.chat.prompt.${part}.bytes" (chat "macro.genai.prompt.${part}.bytes")
    ) promptParts
  );
in
{
  inherit selections;

  # Tags (by label) whose value is free text: an agent harness may name a tool
  # call by the command it runs. What is no plain name becomes `other`. Datadog
  # keeps the text.
  openTags = [ "tool" ];

  metrics = import ./define.nix { inherit lib; } definitions;
}
