# AI and agents: what Datadog's LLM Observability and its "Agent sessions"
# dashboard show, from the derived metrics
# (infra/k8s/observability/cluster/modules/derived-metrics: every call, not only
# the traces that are kept) and, for single turns, from Tempo.
#
# The metrics are delta samples: windows are summed with `sum_over_time`, never
# `rate`. `$__interval` is at least the panels' `interval`, so a bar or point is
# everything that happened in its step.
{ lib }:
let
  prometheus = {
    type = "prometheus";
    uid = "prometheus";
  };
  tempo = {
    type = "tempo";
    uid = "tempo";
  };

  # A metric's samples of one step (or the whole range), summed over replicas.
  over =
    window: by: metric: selector:
    "sum by (${by}) (sum_over_time(${metric}{deployment_environment=\"$env\"${selector}}[${window}]))";
  step = over "$__interval";
  range = over "$__range";
  quantile = q: inner: "histogram_quantile(${q}, ${inner})";
  percent = part: whole: "100 * (${part}) / (${whole})";
  models = '',service=~"$service",model_name=~"$model"'';
  orZero = part: whole: "(${part} or 0 * ${whole})";

  target = refId: legendFormat: expr: {
    inherit refId legendFormat expr;
    datasource = prometheus;
  };
  instant =
    refId: legendFormat: expr:
    target refId legendFormat expr // { instant = true; };
  series = title: description: unit: targets: {
    type = "timeseries";
    datasource = prometheus;
    interval = "5m";
    inherit title description targets;
    fieldConfig.defaults = {
      inherit unit;
      min = 0;
      custom = {
        lineWidth = 2;
        fillOpacity = 0;
        # Nothing happened is a gap, not zero; a lone point still shows.
        showPoints = "auto";
        spanNulls = 900000;
      };
    };
    options = {
      tooltip = {
        mode = "multi";
        sort = "desc";
      };
      legend = {
        displayMode = "list";
        placement = "bottom";
      };
    };
  };
  bars =
    title: description: unit: targets:
    lib.recursiveUpdate (series title description unit targets) {
      fieldConfig.defaults.custom = {
        drawStyle = "bars";
        lineWidth = 0;
        fillOpacity = 80;
        stacking.mode = "normal";
      };
    };
  stat = title: description: unit: targets: {
    type = "stat";
    datasource = prometheus;
    inherit title description targets;
    fieldConfig.defaults = {
      inherit unit;
      noValue = "0";
      color = {
        mode = "fixed";
        fixedColor = "text";
      };
    };
    options = {
      colorMode = "value";
      graphMode = "none";
      reduceOptions.calcs = [ "lastNotNull" ];
    };
  };
  # Ranked horizontal bars over the whole range: one hue, magnitude only.
  ranked = title: description: unit: targets: {
    type = "bargauge";
    datasource = prometheus;
    inherit title description targets;
    fieldConfig.defaults = {
      inherit unit;
      min = 0;
      color = {
        mode = "fixed";
        fixedColor = "blue";
      };
    };
    options = {
      orientation = "horizontal";
      displayMode = "basic";
      valueMode = "text";
      reduceOptions = {
        calcs = [ "lastNotNull" ];
        values = false;
      };
    };
  };
  traces = title: description: query: {
    type = "table";
    datasource = tempo;
    inherit title description;
    targets = [
      {
        refId = "A";
        datasource = tempo;
        queryType = "traceql";
        inherit query;
        limit = 20;
        spss = 1;
        tableType = "traces";
      }
    ];
  };

  at = x: w: h: panel: {
    inherit
      x
      w
      h
      panel
      ;
  };
  thirds = h: lib.imap0 (i: panel: at (i * 8) 8 h panel);
  halves = h: lib.imap0 (i: panel: at (i * 12) 12 h panel);
  rows = [
    {
      title = "Model calls";
      lines = [
        (lib.imap0 (i: panel: at (i * 4) 4 4 panel) [
          (stat "Calls" "Model calls in the selected time range." "short" [
            (instant "A" "calls" "histogram_count(${range "" "ml_obs_span_duration_seconds" models})")
          ])
          (stat "Failed" "Share of model calls whose span ended in an error." "percent" [
            (instant "A" "failed" (percent (orZero (range "" "ml_obs_span_error" models) calls) calls))
          ])
          (stat "Input tokens"
            "As the providers count them: Anthropic without cache reads and writes, OpenAI and Gemini with cache reads."
            "short"
            [
              (instant "A" "input" "histogram_sum(${range "" "ml_obs_span_llm_input_tokens" models})")
            ]
          )
          (stat "Output tokens" "" "short" [
            (instant "A" "output" "histogram_sum(${range "" "ml_obs_span_llm_output_tokens" models})")
          ])
          (stat "Cost"
            "Priced usage (`ai usage priced` log lines), every service and model; the service and model filters don't apply."
            "currencyUSD"
            [
              (instant "A" "cost" "histogram_sum(${range "" "macro_ai_usage_cost_usd" ""})")
            ]
          )
          (stat "Provider account unavailable"
            "Requests refused because the account is suspended or out of credit. Anything but 0 needs a person; see docs/runbooks/ai-providers.md."
            "short"
            [
              (instant "A" "unavailable" (
                lib.concatStringsSep " + " (
                  map (metric: "(${range "" metric ""} or vector(0))") [
                    "macro_ai_provider_account_unavailable"
                    "macro_ai_editing_provider_account_unavailable"
                  ]
                )
              ))
            ]
          )
        ])
        (thirds 8 [
          (bars "Calls by model" "Per step." "short" [
            (target "A" "{{model_name}}"
              "histogram_count(${step "model_name" "ml_obs_span_duration_seconds" models})"
            )
          ])
          (series "Failed calls by model" "Share of each model's calls." "percent" [
            (target "A" "{{model_name}}" (
              let
                all = "histogram_count(${step "model_name" "ml_obs_span_duration_seconds" models})";
              in
              percent (orZero (step "model_name" "ml_obs_span_error" models) all) all
            ))
          ])
          (bars "Cost by provider" "Priced usage per step. `other` is a model id without a provider in it."
            "currencyUSD"
            [
              (target "A" "{{from}}"
                ''histogram_sum(sum by (from) (label_replace(label_replace(${
                  step "provider" "macro_ai_usage_cost_usd" ""
                }, "from", "$1", "provider", "(.+)"), "from", "other", "provider", "")))''
              )
            ]
          )
        ])
        (thirds 8 [
          (series "Call latency p50 by model"
            "Request to last chunk; for an AI editing step, to the end of its tools."
            "s"
            [
              (target "A" "{{model_name}}" (
                quantile "0.5" (step "model_name" "ml_obs_span_duration_seconds" models)
              ))
            ]
          )
          (series "Call latency p95 by model"
            "Request to last chunk; for an AI editing step, to the end of its tools."
            "s"
            [
              (target "A" "{{model_name}}" (
                quantile "0.95" (step "model_name" "ml_obs_span_duration_seconds" models)
              ))
            ]
          )
          (series "Time to first chunk p50 by model" "Request to the first streamed chunk." "ms" [
            (target "A" "{{model_name}}" (
              quantile "0.5" (step "model_name" "macro_genai_chat_time_to_first_chunk_ms" models)
            ))
          ])
        ])
        (halves 8 [
          (series "Tokens by kind"
            "Per step, as each provider counts them: OpenAI's and Gemini's input includes what it read from the cache, Anthropic's doesn't."
            "short"
            [
              (target "A" "input" "histogram_sum(${step "" "ml_obs_span_llm_input_tokens" models})")
              (target "B" "cache read"
                "histogram_sum(${step "" "ml_obs_span_llm_input_cache_read_tokens" models})"
              )
              (target "C" "cache write"
                "histogram_sum(${step "" "ml_obs_span_llm_input_cache_write_tokens" models})"
              )
              (target "D" "output" "histogram_sum(${step "" "ml_obs_span_llm_output_tokens" models})")
            ]
          )
          (bars "Output tokens by model" "Per step." "short" [
            (target "A" "{{model_name}}"
              "histogram_sum(${step "model_name" "ml_obs_span_llm_output_tokens" models})"
            )
          ])
        ])
      ];
    }
    {
      title = "Agent turns";
      lines = [
        (halves 8 [
          (series "Turn latency p50 by model"
            "The agent loop's run of one turn: model calls and tools, from the first request to the last chunk."
            "s"
            [
              (target "A" "{{model}}" (quantile "0.5" (step "model" "macro_agent_turn_duration_seconds" "")))
            ]
          )
          (series "Turn latency p90 by model" "" "s" [
            (target "A" "{{model}}" (quantile "0.9" (step "model" "macro_agent_turn_duration_seconds" "")))
          ])
        ])
        (halves 8 [
          (series "Model round-trips per turn, average by model" "" "short" [
            (target "A" "{{model}}" "histogram_avg(${step "model" "macro_agent_turn_model_calls" ""})")
          ])
          (series "Wait for a conversation summary before a turn, p90" "" "ms" [
            (target "A" "wait" (quantile "0.9" (step "" "macro_agent_turn_compaction_wait_ms" "")))
          ])
        ])
      ];
    }
    {
      title = "Prompt cache and context";
      lines = [
        (thirds 10 [
          (series "Cache hit rate, Anthropic" "Cache reads over all input (reads, writes and uncached)."
            "percent"
            [
              (target "A" "hit rate" (
                let
                  tokens = metric: "histogram_sum(${step "" metric '',provider="anthropic"''})";
                  read = tokens "macro_agent_chat_cache_read_tokens";
                in
                percent read "${read} + ${orZero (tokens "macro_agent_chat_cache_write_tokens") read} + ${tokens "macro_agent_chat_input_tokens"}"
              ))
            ]
          )
          (series "Cache hit rate, OpenAI and Gemini" "Cache reads over input, which includes them." "percent"
            [
              (target "A" "{{provider}}" (
                let
                  tokens = metric: "histogram_sum(${step "provider" metric '',provider!="anthropic"''})";
                in
                percent (tokens "macro_agent_chat_cache_read_tokens") (tokens "macro_agent_chat_input_tokens")
              ))
            ]
          )
          (ranked "Average bytes per model call, by prompt part" "Over the selected time range." "bytes" (
            lib.imap0 (
              i: part:
              instant (builtins.elemAt lib.upperChars i) part
                "histogram_avg(${
                  range "" "macro_agent_chat_prompt_${lib.replaceStrings [ "." ] [ "_" ] part}_bytes" ""
                })"
            ) promptParts
          ))
        ])
      ];
    }
    {
      title = "Tools";
      lines = [
        (thirds 9 [
          (lib.recursiveUpdate
            (series "Tool calls failing"
              "Over the hour before each point, as the Datadog monitor evaluates it (warning 14 %, critical 20 %)."
              "percent"
              [
                (target "A" "failing" (
                  let
                    calls = over "1h" "" "macro_agent_tool_calls" "";
                  in
                  percent (orZero (over "1h" "" "macro_agent_tool_errors" "") calls) calls
                ))
              ]
            )
            {
              fieldConfig.defaults = {
                custom.thresholdsStyle.mode = "line";
                thresholds = {
                  mode = "absolute";
                  steps = [
                    {
                      color = "transparent";
                      value = null;
                    }
                    {
                      color = "orange";
                      value = 14;
                    }
                    {
                      color = "red";
                      value = 20;
                    }
                  ];
                };
              };
            }
          )
          (ranked "Failure rate by tool, worst 15"
            "Over the selected time range. `other` is every tool whose name isn't a plain name, such as a harness naming a call by its command."
            "percent"
            [
              (instant "A" "{{tool}}" (
                "sort_desc(topk(15, ${
                  percent (range "tool" "macro_agent_tool_errors" "") (range "tool" "macro_agent_tool_calls" "")
                }))"
              ))
            ]
          )
          (ranked "Result size p90 by tool, largest 15" "Over the selected time range." "bytes" [
            (instant "A" "{{tool}}"
              "sort_desc(topk(15, ${quantile "0.9" (range "tool" "macro_agent_tool_result_bytes" "")}))"
            )
          ])
        ])
        (thirds 8 [
          (ranked "Calls by tool, most used 15" "Over the selected time range." "short" [
            (instant "A" "{{tool}}" "sort_desc(topk(15, ${range "tool" "macro_agent_tool_calls" ""}))")
          ])
          (bars "Results cut for the model, by tool" "Results the model saw only the beginning of, per step."
            "short"
            [
              (target "A" "{{tool}}" (step "tool" "macro_agent_tool_results_cut" ""))
            ]
          )
          (series "Code-mode failure rate"
            "Failed programs over programs. They come back as results, so only the turn counts them."
            "percent"
            [
              (target "A" "failing" (
                percent "histogram_sum(${step "" "macro_agent_turn_code_failures" ""})" "histogram_sum(${
                  step "" "macro_agent_turn_code_executions" ""
                })"
              ))
            ]
          )
        ])
      ];
    }
    {
      title = "Traces";
      lines = [
        (halves 9 [
          (traces "Turns that failed"
            "The latest 20 of agent-harness-service, any model. Failed traces are kept while the service is within its sampling budget. Prompt and response text is removed before storage."
            ''{resource.service.name="agent-harness-service" && resource.deployment.environment="$env" && name="agent.turn" && status=error}''
          )
          (traces "Model calls that failed" "The latest 20 of the services above, any model, as sampled."
            ''{resource.deployment.environment="$env" && resource.service.name=~"$service" && span.gen_ai.operation.name="chat" && status=error}''
          )
        ])
        [
          (at 0 24 9 (
            traces "One session"
              "Up to 20 kept traces, in any environment, of the session whose id is in the Session id box (`gen_ai.conversation.id`). Production's fast, successful turns are sampled."
              ''{span.gen_ai.conversation.id="$session"}''
          ))
        ]
      ];
    }
  ];
  calls = "histogram_count(${range "" "ml_obs_span_duration_seconds" models})";
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

  # Rows and their lines top to bottom, each with its place and a running id.
  layout =
    (lib.foldl'
      (
        { y, panels }:
        row:
        let
          header = {
            type = "row";
            inherit (row) title;
            collapsed = false;
            panels = [ ];
            gridPos = {
              x = 0;
              inherit y;
              w = 24;
              h = 1;
            };
          };
          placed =
            lib.foldl'
              (
                acc: line:
                let
                  height = lib.foldl' lib.max 0 (map (cell: cell.h) line);
                in
                {
                  y = acc.y + height;
                  panels =
                    acc.panels
                    ++ map (
                      cell:
                      cell.panel
                      // {
                        gridPos = {
                          inherit (cell) x w h;
                          inherit (acc) y;
                        };
                      }
                    ) line;
                }
              )
              {
                y = y + 1;
                panels = [ ];
              }
              row.lines;
        in
        {
          inherit (placed) y;
          panels = panels ++ [ header ] ++ placed.panels;
        }
      )
      {
        y = 0;
        panels = [ ];
      }
      rows
    ).panels;

  variable = name: label: query: {
    inherit name label query;
    type = "query";
    datasource = prometheus;
    refresh = 2;
    sort = 1;
  };
  all = {
    includeAll = true;
    multi = true;
    allValue = ".*";
    current = {
      text = "All";
      value = "$__all";
    };
  };
in
{
  uid = "macro-agents";
  title = "AI and agents";
  schemaVersion = 39;
  version = 1;
  editable = false;
  tags = [
    "macro"
    "ai"
  ];
  timezone = "browser";
  refresh = "1m";
  time = {
    from = "now-6h";
    to = "now";
  };
  description = "Model calls, agent turns, prompt cache and tools, counted from every span before trace sampling. Fields: crates/agent_session/README.md; metric definitions: infra/k8s/observability/cluster/modules/derived-metrics.";
  templating.list = [
    (
      variable "env" "Environment" "label_values(ml_obs_span_duration_seconds, deployment_environment)"
      // {
        current = {
          text = "dev";
          value = "dev";
        };
      }
    )
    (
      variable "service" "Service"
        ''label_values(ml_obs_span_duration_seconds{deployment_environment="$env"}, service)''
      // all
    )
    (
      variable "model" "Model"
        ''label_values(ml_obs_span_duration_seconds{deployment_environment="$env"}, model_name)''
      // all
    )
    {
      name = "session";
      label = "Session id";
      type = "textbox";
      query = "";
    }
  ];
  panels = lib.imap1 (id: panel: panel // { inherit id; }) layout;
}
