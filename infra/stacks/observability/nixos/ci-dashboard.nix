{ lib, pkgs, ... }:
let
  tempo = {
    type = "tempo";
    uid = "tempo";
  };
  # Shared with scripts/ci-report.ts, so the daily report and these panels agree.
  report = builtins.fromJSON (builtins.readFile ./ci-report.json);
  # Green under three minutes, red from five: the CI target for a push's wall time.
  wallThresholds = {
    mode = "absolute";
    steps = [
      {
        color = "green";
        value = null;
      }
      {
        color = "orange";
        value = 180;
      }
      {
        color = "red";
        value = 300;
      }
    ];
  };
  inherit
    (import ./loki-report-panels.nix {
      inherit lib report;
      statThresholds = {
        p50 = wallThresholds;
        p90 = wallThresholds;
      };
    })
    expand
    grid
    lokiSeries
    lokiStat
    lokiTable
    row
    ;

  wallTarget = quantile: by: legendFormat: {
    inherit legendFormat;
    expr = expand "1d" "quantile_over_time(${quantile}, $PUSH | unwrap wall_seconds | __error__=\"\" [$RANGE]) by (${by})";
  };

  tracesTop = 47;
  panel = id: title: description: filter: fields: {
    inherit id title description;
    type = "table";
    datasource = tempo;
    gridPos = grid 0 (tracesTop + (id - 1) * 10) 24 10;
    targets = [
      {
        refId = "A";
        queryType = "traceql";
        query = "{ ${selector} && ${filter} } | select(name, ${fields})";
        tableType = "spans";
        limit = 100;
        spss = 100;
      }
    ];
    transformations = [
      {
        id = "organize";
        options = {
          excludeByName = {
            "Trace Service" = true;
            "deployment.environment" = true;
            "service.name" = true;
            workflow_run_id = true;
            job_id = true;
            workflow_name = true;
            job_name = true;
            step_name = true;
          };
          indexByName = {
            "Name" = 0;
            conclusion = 1;
            "Duration" = 2;
            "Start time" = 3;
            "Span ID" = 4;
            "Trace Name" = 5;
          };
        };
      }
    ];
    options.showHeader = true;
  };
  selector = ''resource.service.name="github-actions" && resource.deployment.environment="ci"'';

  dashboard = {
    uid = "macro-ci";
    title = "Macro CI";
    description = "Where CI time goes. The top section reads the exporter's push, job and step events in Loki, kept 30 days, over the selected range; set it to a day or more for percentiles. The bottom section searches the run traces in Tempo, kept 7 days: open a trace for its execution waterfall. Trace tables are bounded search results, not complete counts.";
    schemaVersion = 39;
    version = 3;
    editable = false;
    tags = [
      "macro"
      "ci"
    ];
    timezone = "browser";
    refresh = "5m";
    time = {
      from = "now-24h";
      to = "now";
    };
    panels = [
      (row 100 0 "Wall time and where it goes, from Loki events")
      (lokiStat 5 "summary" (grid 0 1 24 4))
      (lokiTable 6 "wall" (grid 0 5 12 8))
      (lokiSeries 7 (grid 12 5 12 8) "Real PR wall time, rolling 24 h"
        "Each point covers the 24 hours before it. Red line: the 5 minute target."
        "s"
        "15m"
        [
          (wallTarget "0.5" "" "p50")
          (wallTarget "0.9" "" "p90")
        ]
        {
          fieldConfig.defaults = {
            thresholds = {
              mode = "absolute";
              steps = [
                {
                  color = "transparent";
                  value = null;
                }
                {
                  color = "red";
                  value = 300;
                }
              ];
            };
            custom.thresholdsStyle.mode = "line";
          };
        }
      )
      (lokiSeries 8 (grid 0 13 12 8) "p90 wall time by PR type, rolling 24 h"
        "Real PR pushes only; a type with few pushes moves in steps."
        "s"
        "15m"
        [ (wallTarget "0.9" "pr_type" "{{pr_type}}") ]
        { }
      )
      (lokiTable 9 "last" (grid 12 13 12 8))
      (lokiTable 10 "jobs" (grid 0 21 12 10))
      (lokiTable 11 "steps" (grid 12 21 12 10))
      (lokiTable 12 "queue_runner" (grid 0 31 8 8))
      (lokiTable 13 "queue_job" (grid 8 31 8 8))
      (lokiTable 14 "volumes" (grid 16 31 8 8))
      (lokiSeries 15 (grid 0 39 12 8) "CI hours by trigger"
        "Job run time summed per interval, queue excluded. Compare days to measure a change such as running CI only on labelled PRs."
        "short"
        "1h"
        [
          {
            legendFormat = "{{event_name}}";
            expr = expand "$__interval" "sum by (event_name) (sum_over_time($JOB | unwrap run_seconds | __error__=\"\" [$RANGE])) / 3600";
          }
        ]
        {
          fieldConfig.defaults.custom = {
            axisLabel = "CI hours";
            drawStyle = "bars";
            fillOpacity = 80;
            stacking.mode = "normal";
          };
        }
      )
      (lokiTable 16 "hours" (grid 12 39 6 8))
      (lokiStat 17 "exporter" (grid 18 39 6 8))
      (row 101 (tracesTop - 1) "Run traces, from Tempo")
      (panel 1 "Workflow runs — open a trace for jobs and steps"
        "Workflow duration includes waiting; for reruns the upstream exporter starts the root span at the original run creation. Use job durations for execution timing. The url attribute links to GitHub."
        "span.workflow_run_id != nil"
        "span.workflow_name, span.conclusion, span.run_attempt, span.url"
      )
      (panel 2 "Failed, cancelled or timed-out jobs"
        "Cancellation is included; inspect the conclusion attribute to distinguish it from a failure."
        "span.job_id != nil && status = error"
        "span.workflow_name, span.job_name, span.conclusion, span.runner_name"
      )
      (panel 3 "Jobs taking more than five minutes"
        "Job span duration measures execution, excluding runner queue time."
        "span.job_id != nil && duration > 5m"
        "span.workflow_name, span.job_name, span.conclusion, span.runner_name"
      )
      (panel 4 "Failed, cancelled or timed-out steps"
        "Open the trace to see the step in its parent job and workflow. Raw build logs and individual test cases remain in GitHub."
        "span.step_name != nil && status = error"
        "span.step_name, span.conclusion"
      )
    ];
  };
in
{
  services.grafana.provision.dashboards.settings.providers = [
    {
      name = "macro-ci";
      orgId = 1;
      folder = "Macro";
      type = "file";
      disableDeletion = true;
      allowUiUpdates = false;
      options.path = pkgs.linkFarm "macro-ci-dashboard" [
        {
          name = "ci.json";
          path = pkgs.writeText "ci.json" (builtins.toJSON dashboard);
        }
      ];
    }
  ];
}
