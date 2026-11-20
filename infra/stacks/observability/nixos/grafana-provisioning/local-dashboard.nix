{ lib }:
let
  # Shared with scripts/ci-report.ts --spec local, so the report and these panels agree.
  report = builtins.fromJSON (builtins.readFile ./local-report.json);
  # Every filter names its machine; the dashboard narrows each to the Machine variable.
  dashboardReport = report // {
    filters = lib.mapAttrs (_: filter: ''${filter} | machine=~"$machine"'') report.filters;
  };
  inherit
    (import ./loki-report-panels.nix {
      inherit lib;
      report = dashboardReport;
    })
    expand
    grid
    lokiSeries
    lokiStat
    lokiTable
    lokiTableOf
    row
    ;

  loki = {
    type = "loki";
    uid = "loki";
  };
  tempo = {
    type = "tempo";
    uid = "tempo";
  };

  starts = [
    {
      start = "fresh";
      title = "Fresh start";
    }
    {
      start = "resume";
      title = "Resume";
    }
  ];

  readyTarget = quantile: legendFormat: by: {
    inherit legendFormat;
    expr = expand "1d" "quantile_over_time(${quantile}, $READY | unwrap seconds | __error__=\"\" [$RANGE]) by (${by})";
  };

  instant = refId: expr: legendFormat: {
    inherit refId legendFormat;
    datasource = loki;
    expr = expand "$__range" expr;
    queryType = "instant";
  };

  byName = name: properties: {
    matcher = {
      id = "byName";
      options = name;
    };
    inherit properties;
  };

  # A step's part of all foreground (critical-path) time for one kind of start.
  shareExpr =
    start:
    "sum by (step) (sum_over_time($CRIT | start=\"${start}\" | unwrap seconds | __error__=\"\" [$RANGE])) / on () group_left sum(sum_over_time($CRIT | start=\"${start}\" | unwrap seconds | __error__=\"\" [$RANGE]))";

  # The step that takes the biggest share of a start's foreground time.
  bottleneckStat = id: gridPos: start: title: {
    inherit id gridPos;
    title = "Bottleneck: ${title}";
    description = "The foreground step that takes the biggest share of a ${start} bring-up's critical path in the range, and that share. See Critical path for the rest.";
    type = "stat";
    datasource = loki;
    targets = [ (instant "A" "topk(1, ${shareExpr start})" "") ];
    # Instant Loki results reach panels as a table; name the share by its step.
    transformations = [
      {
        id = "rowsToFields";
        options.mappings = [
          {
            fieldName = "step";
            handlerKey = "field.name";
          }
          {
            fieldName = "Value #A";
            handlerKey = "field.value";
          }
          {
            fieldName = "Time";
            handlerKey = "__ignore";
          }
        ];
      }
    ];
    fieldConfig.defaults = {
      unit = "percentunit";
      decimals = 0;
      noValue = "No runs with lanes yet";
      color = {
        mode = "fixed";
        fixedColor = "orange";
      };
    };
    options = {
      reduceOptions = {
        calcs = [ "lastNotNull" ];
        fields = "";
        values = false;
      };
      colorMode = "value";
      graphMode = "none";
      textMode = "value_and_name";
      justifyMode = "center";
      text.titleSize = 14;
    };
  };

  # Top-level steps on every lane, named with their lane when it is not the foreground.
  laneBar = ''label_format bar=`{{ if and .lane (ne .lane "main") }}{{ .lane }} · {{ end }}{{ .step }}`'';

  # A Gantt chart of the typical bring-up: each top-level step's median start
  # (transparent) and median length, in start order.
  gantt = id: gridPos: start: title: {
    inherit id gridPos;
    title = "Typical ${lib.toLower title}";
    description = "Each top-level step of a ${start} bring-up at its median start and median length, in start order. Steps on another lane (frontend, FusionAuth, LocalStack) run beside the foreground and are named with their lane. Recorded since runs gained offsets.";
    type = "barchart";
    datasource = loki;
    targets = [
      (instant "A"
        "quantile_over_time(0.5, $TOP | start=\"${start}\" | offset_in_run!=\"\" | ${laneBar} | unwrap offset_in_run | __error__=\"\" [$RANGE]) by (bar)"
        "Starts at"
      )
      (instant "B"
        "quantile_over_time(0.5, $TOP | start=\"${start}\" | offset_in_run!=\"\" | ${laneBar} | unwrap seconds | __error__=\"\" [$RANGE]) by (bar)"
        "Takes"
      )
    ];
    transformations = [
      {
        id = "merge";
        options = { };
      }
      {
        id = "organize";
        options = {
          excludeByName.Time = true;
          renameByName = {
            bar = "Step";
            "Value #A" = "Starts at";
            "Value #B" = "Takes";
          };
        };
      }
      {
        id = "sortBy";
        options.sort = [ { field = "Starts at"; } ];
      }
    ];
    fieldConfig = {
      defaults = {
        unit = "s";
        color = {
          mode = "fixed";
          fixedColor = "blue";
        };
        custom = {
          fillOpacity = 80;
          lineWidth = 0;
          axisPlacement = "bottom";
        };
      };
      overrides = [
        (byName "Starts at" [
          {
            id = "color";
            value = {
              mode = "fixed";
              fixedColor = "transparent";
            };
          }
          {
            id = "custom.fillOpacity";
            value = 0;
          }
          {
            id = "custom.hideFrom";
            value = {
              legend = true;
              tooltip = false;
              viz = false;
            };
          }
        ])
      ];
    };
    options = {
      orientation = "horizontal";
      stacking = "normal";
      xField = "Step";
      showValue = "never";
      barWidth = 0.8;
      groupWidth = 0.8;
      xTickLabelMaxLength = 48;
      legend.showLegend = false;
      tooltip.mode = "multi";
    };
  };

  criticalTable =
    id: gridPos: start: title:
    let
      panel = lokiTableOf id {
        title = "Critical path: ${lib.toLower title}";
        description = "The foreground steps a ${start} bring-up waits on, in order of their share of its foreground time. A step on another lane counts only through the foreground step that waits for it.";
        by = [ "step" ];
        sort = "Share";
        columns = [
          {
            name = "Share";
            unit = "percentunit";
            expr = shareExpr start;
          }
          {
            name = "p50";
            unit = "s";
            expr = "quantile_over_time(0.5, $CRIT | start=\"${start}\" | unwrap seconds | __error__=\"\" [$RANGE]) by (step)";
          }
          {
            name = "p90";
            unit = "s";
            expr = "quantile_over_time(0.9, $CRIT | start=\"${start}\" | unwrap seconds | __error__=\"\" [$RANGE]) by (step)";
          }
          {
            name = "Runs";
            unit = "short";
            expr = "sum by (step) (count_over_time($CRIT | start=\"${start}\" [$RANGE]))";
          }
        ];
      } gridPos;
    in
    panel
    // {
      fieldConfig = panel.fieldConfig // {
        overrides = panel.fieldConfig.overrides ++ [
          (byName "step" [
            {
              id = "custom.minWidth";
              value = 300;
            }
          ])
          (byName "Share" [
            {
              id = "custom.cellOptions";
              value = {
                type = "gauge";
                mode = "basic";
                valueDisplayMode = "text";
              };
            }
            {
              id = "max";
              value = 1;
            }
            {
              id = "min";
              value = 0;
            }
            {
              id = "color";
              value = {
                mode = "fixed";
                fixedColor = "orange";
              };
            }
          ])
        ];
      };
    };

  tracePanel = id: gridPos: start: title: {
    inherit id gridPos;
    title = "${title}: \$${start}_run";
    description = "A ${start} bring-up's steps as a trace: lanes, nested steps, the crates its service build compiled and the services it waited on. Pick another run with the ${title} variable, or from Recent bring-ups. Traces are kept 7 days; runs recorded before traces were keyed by run do not show here, and with no such run in 7 days the panel reports no data.";
    type = "traces";
    datasource = tempo;
    targets = [
      {
        refId = "A";
        datasource = tempo;
        queryType = "traceql";
        query = "\$${start}_run";
      }
    ];
  };

  runPicker = start: title: {
    name = "${start}_run";
    label = title;
    description = "${title}s that reached ready on the chosen machines, newest first, as run id/machine. The traces panels open it.";
    type = "query";
    datasource = tempo;
    query = {
      refId = "${start}_run";
      type = 1;
      label = "bring_up";
    };
    # bring_up is <start>/<run_id>/<machine>; the run id is the trace id, and
    # sorts by time because it is a UUIDv7.
    regex = "/^${start}\\/(?<text>(?<value>[0-9a-f]{32})\\/(?:$machine))$/";
    refresh = 2;
    sort = 2;
  };

  # The local stacks' own traces, logs and metrics, from machines whose local
  # telemetry settings say `services = true` (docs/development/running-locally.md).
  # Their forwarder tags everything `host.name` = the machine's name and
  # `deployment.environment` = local.
  localTop = 140;
  machineFilter = ''host_name=~"$machine"'';
  serviceLogs = ''{deployment_environment="local", service_name!="local-telemetry"} | ${machineFilter}'';
  errorLogs = ''${serviceLogs} | severity_text=~"(?i)error|fatal|critical"'';
  bothLabels = "host_name, macro_local_instance";

  recentRuns = {
    id = 13;
    type = "table";
    title = "Recent bring-ups";
    description = "The latest bring-ups on the chosen machines. A trace id opens that run's trace in Explore, or here as the fresh or resume run.";
    datasource = loki;
    gridPos = grid 0 49 24 9;
    targets = [
      {
        refId = "A";
        datasource = loki;
        expr = expand "" "$RUN";
        queryType = "range";
        maxLines = 100;
      }
    ];
    transformations = [
      {
        id = "extractFields";
        options = {
          source = "labels";
          replace = false;
        };
      }
      {
        id = "filterFieldsByName";
        options.include.names = [
          "Time"
          "machine"
          "start"
          "detached"
          "outcome"
          "seconds"
          "failed_step"
          "trace_id"
        ];
      }
      {
        id = "convertFieldType";
        options.conversions = [
          {
            targetField = "seconds";
            destinationType = "number";
          }
        ];
      }
      {
        id = "organize";
        options = {
          indexByName = {
            Time = 0;
            machine = 1;
            start = 2;
            detached = 3;
            outcome = 4;
            seconds = 5;
            failed_step = 6;
            trace_id = 7;
          };
          renameByName = {
            seconds = "Time to ready";
            failed_step = "Stopped at";
          };
        };
      }
      {
        id = "sortBy";
        options.sort = [
          {
            field = "Time";
            desc = true;
          }
        ];
      }
    ];
    fieldConfig = {
      defaults.custom.minWidth = 60;
      overrides = [
        (byName "Time to ready" [
          {
            id = "unit";
            value = "s";
          }
        ])
        (byName "trace_id" [
          {
            id = "links";
            value = [
              {
                title = "Open in Explore";
                url = "";
                internal = {
                  datasourceUid = "tempo";
                  datasourceName = "Tempo";
                  query = {
                    queryType = "traceql";
                    query = "\${__value.raw}";
                  };
                };
              }
              {
                title = "Show this run's trace here";
                url = "/d/macro-run-local?\${__url_time_range}&\${machine:queryparam}&var-\${__data.fields.start}_run=\${__value.raw}";
              }
            ];
          }
        ])
      ];
    };
    options = {
      showHeader = true;
      cellHeight = "sm";
    };
  };

  stepMatrix = {
    id = 33;
    type = "table";
    title = "Steps by machine, p50";
    description = "Each top-level step's median on each machine: a column that is darker than the others is a machine that is slow at that step.";
    datasource = loki;
    gridPos = grid 0 97 24 12;
    targets = [
      (instant "A"
        "quantile_over_time(0.5, $TOP | unwrap seconds | __error__=\"\" [$RANGE]) by (machine, step)"
        ""
      )
    ];
    transformations = [
      {
        id = "merge";
        options = { };
      }
      {
        id = "groupingToMatrix";
        options = {
          columnField = "machine";
          rowField = "step";
          valueField = "Value #A";
          emptyValue = "null";
        };
      }
      {
        id = "organize";
        options.renameByName."step\\machine" = "Step";
      }
    ];
    fieldConfig = {
      defaults = {
        unit = "s";
        decimals = 0;
        custom = {
          minWidth = 90;
          cellOptions = {
            type = "color-background";
            mode = "gradient";
          };
        };
        color.mode = "continuous-GrYlRd";
      };
      overrides = [
        (byName "Step" [
          {
            id = "custom.cellOptions";
            value.type = "auto";
          }
          {
            id = "custom.width";
            value = 300;
          }
        ])
      ];
    };
    options = {
      showHeader = true;
      cellHeight = "sm";
    };
  };

  dashboard = {
    uid = "macro-run-local";
    title = "Macro run_local";
    description = "Where `just run_local` time goes, from the local telemetry events (on by default) in Loki (service_name=local-telemetry, kept 30 days) and each run's trace in Tempo (kept 7 days). Set the range to a day or more for percentiles; the Machine variable narrows every panel. The last row shows the local stacks' own traces and logs from machines that turned on `services = true`.";
    schemaVersion = 39;
    version = 2;
    editable = false;
    tags = [
      "macro"
      "local"
    ];
    timezone = "browser";
    refresh = "5m";
    time = {
      from = "now-7d";
      to = "now";
    };
    panels = [
      (row 100 0 "Time to ready")
      (lokiStat 1 "summary" (grid 0 1 12 4))
      (bottleneckStat 10 (grid 12 1 6 4) "fresh" "fresh start")
      (bottleneckStat 11 (grid 18 1 6 4) "resume" "resume")
      (lokiTable 2 "ready" (grid 0 5 12 7))
      (lokiSeries 3 (grid 12 5 12 7) "Time to ready, rolling 24 h"
        "Each point covers the 24 hours before it, by fresh or resumed start."
        "s"
        "15m"
        [
          (readyTarget "0.5" "p50 {{start}}" "start")
          (readyTarget "0.9" "p90 {{start}}" "start")
        ]
        { }
      )

      (row 101 12 "One bring-up as a trace")
      (tracePanel 14 (grid 0 13 24 18) "fresh" "Fresh start")
      (tracePanel 15 (grid 0 31 24 18) "resume" "Resume")
      recentRuns

      (row 102 58 "Bottleneck: what a bring-up waits on")
      (gantt 16 (grid 0 59 12 13) "fresh" "Fresh start")
      (gantt 17 (grid 12 59 12 13) "resume" "Resume")
      (criticalTable 18 (grid 0 72 12 9) "fresh" "Fresh start")
      (criticalTable 19 (grid 12 72 12 9) "resume" "Resume")

      (row 103 81 "Machines")
      (lokiTable 30 "machines" (grid 0 82 24 7))
      (lokiSeries 31 (grid 0 89 12 8) "Time to ready by machine, rolling 24 h p50"
        "Each point covers the 24 hours before it, fresh and resumed starts together."
        "s"
        "15m"
        [ (readyTarget "0.5" "{{machine}}" "machine") ]
        { }
      )
      (lokiSeries 32 (grid 12 89 12 8) "Bring-ups by machine"
        "Bring-ups started per machine, ready or not. The Machines table has each machine's ready share."
        "short"
        "1h"
        [
          {
            expr = expand "$__auto" "sum by (machine) (count_over_time($RUN [$RANGE]))";
            legendFormat = "{{machine}}";
          }
        ]
        {
          fieldConfig.defaults.custom = {
            drawStyle = "bars";
            stacking.mode = "normal";
            fillOpacity = 80;
          };
        }
      )
      stepMatrix

      (row 104 109 "Inside the steps")
      # Full width: step names are long.
      (lokiTable 4 "steps" (grid 0 110 24 10))
      (lokiTable 40 "nested" (grid 0 120 12 9))
      (lokiTable 41 "crates" (grid 12 120 12 9))
      (lokiTable 5 "services" (grid 0 129 12 11))
      (lokiTable 7 "builds" (grid 12 129 12 5))
      (lokiTable 8 "actions" (grid 12 134 12 6))

      (row 105 localTop "Failures and local stacks (`services = true`)")
      (lokiTable 6 "failures" (grid 0 (localTop + 1) 12 8))
      (
        (lokiTableOf 21 {
          title = "Stacks sending telemetry, last 24 hours";
          description = "Each machine's stacks by instance, from their log lines. A stack started before `services = true` was turned on has no instance until its next bring-up.";
          by = [
            "host_name"
            "macro_local_instance"
          ];
          sort = "Log lines";
          columns = [
            {
              name = "Services";
              unit = "short";
              expr = "count by (${bothLabels}) (sum by (${bothLabels}, service_name) (count_over_time(${serviceLogs} [$RANGE])))";
            }
            {
              name = "Log lines";
              unit = "short";
              expr = "sum by (${bothLabels}) (count_over_time(${serviceLogs} [$RANGE]))";
            }
            {
              name = "Errors";
              unit = "short";
              expr = "sum by (${bothLabels}) (count_over_time(${errorLogs} [$RANGE]))";
            }
          ];
        } (grid 12 (localTop + 1) 12 8))
        // {
          timeFrom = "24h";
        }
      )
      {
        id = 22;
        type = "table";
        title = "Recent local traces";
        description = "Sampled on each machine: every trace with an error and a tenth of the rest. Open a trace ID for its waterfall; expand a row for its machine and instance.";
        datasource = tempo;
        gridPos = grid 0 (localTop + 9) 24 10;
        targets = [
          {
            refId = "A";
            datasource = tempo;
            queryType = "traceql";
            query = ''{resource.deployment.environment="local" && resource.host.name=~"$machine"} | select(resource.host.name, resource.macro.local.instance)'';
            tableType = "traces";
            limit = 50;
            spss = 1;
          }
        ];
        options.showHeader = true;
      }
      (lokiSeries 23 (grid 0 (localTop + 19) 24 8) "Local error logs"
        "Error, fatal and critical log lines from local services, by machine and service."
        "short"
        "1m"
        [
          {
            expr = "sum by (host_name, service_name) (count_over_time(${errorLogs} [$__auto]))";
            legendFormat = "{{host_name}} {{service_name}}";
          }
        ]
        { }
      )
      {
        id = 24;
        type = "logs";
        title = "Local service logs";
        datasource = loki;
        gridPos = grid 0 (localTop + 27) 24 12;
        targets = [
          {
            refId = "A";
            datasource = loki;
            expr = serviceLogs;
          }
        ];
      }
    ];
    templating.list = [
      {
        name = "machine";
        label = "Machine";
        description = "Machines with run_local traces in the last 7 days: their `machine` setting, or a hash of the hostname. Runs recorded before traces carried the machine are in the panels under All.";
        type = "query";
        datasource = tempo;
        query = {
          refId = "machine";
          type = 1;
          label = "machine";
        };
        refresh = 2;
        sort = 1;
        multi = true;
        includeAll = true;
        allValue = ".+";
        current = {
          text = "All";
          value = "$__all";
        };
      }
    ]
    ++ map ({ start, title }: runPicker start title) starts;
  };
in
dashboard
