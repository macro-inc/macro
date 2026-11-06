{ lib, pkgs, ... }:
let
  prometheus = {
    type = "prometheus";
    uid = "prometheus";
  };
  loki = {
    type = "loki";
    uid = "loki";
  };
  selector = ''job="integrations/postgres",deployment_environment="dev",db_instance=~"$database",datname="macrodb",user=~"''${dbuser:regex}",queryid=~"$queryid"'';
  logs = ''job="integrations/postgres-queries",deployment_environment="dev",db_instance=~"$database"'';
  panel = id: title: datasource: targets: {
    inherit
      id
      title
      datasource
      targets
      ;
    type = "timeseries";
    gridPos = {
      x = lib.mod (id - 2) 2 * 12;
      y = 16 + builtins.div (id - 2) 2 * 9;
      w = 12;
      h = 9;
    };
  };
  metric =
    id: title: expr: unit:
    (panel id title prometheus [
      {
        refId = "A";
        inherit expr;
        legendFormat = "{{db_instance}} {{user}} {{queryid}}";
      }
    ])
    // {
      fieldConfig.defaults = { inherit unit; };
    };
  logPanel =
    id: title: expr:
    (panel id title loki [
      {
        refId = "A";
        inherit expr;
        queryType = "range";
      }
    ])
    // {
      type = "logs";
      options = {
        showTime = true;
        showCommonLabels = false;
        wrapLogMessage = true;
        sortOrder = "Descending";
      };
    };
  totals =
    name: "sum by (queryid) (increase(pg_stat_statements_${name}_total{${selector}}[$__range]))";
  timeTotals = totals "seconds";
  callTotals = totals "calls";
  rowTotals = totals "rows";
  ranking = "topk($top, ${timeTotals} > 0)";
  instant = refId: expr: {
    inherit refId expr;
    datasource = prometheus;
    instant = true;
    range = false;
    format = "table";
  };
  field = name: properties: {
    matcher = {
      id = "byName";
      options = name;
    };
    inherit properties;
  };
  unit = value: {
    id = "unit";
    inherit value;
  };
  summary =
    id: title: expr: unitName: x:
    (metric id title expr unitName)
    // {
      type = "stat";
      gridPos = {
        inherit x;
        y = 0;
        w = 6;
        h = 4;
      };
      targets = [ (instant "A" expr) ];
      description = "Selected queries within the bounded collected statement set. Missing data is not replaced by zero. These summaries are not health thresholds.";
      fieldConfig.defaults = {
        unit = unitName;
        color = {
          mode = "fixed";
          fixedColor = "blue";
        };
      };
      options = {
        colorMode = "value";
        graphMode = "none";
        reduceOptions = {
          calcs = [ "lastNotNull" ];
          fields = "";
          values = false;
        };
      };
    };
  dashboard = {
    uid = "macro-postgres-queries";
    title = "Macro PostgreSQL queries";
    schemaVersion = 39;
    version = 2;
    editable = false;
    tags = [
      "macro"
      "postgres"
      "queries"
    ];
    timezone = "browser";
    refresh = "1m";
    time = {
      from = "now-1h";
      to = "now";
    };
    description = "Dev query statistics and sampled activity. Select an instance and database user, filter the SQL column, then click a query ID to investigate. All workload totals cover the collected statement set, not every query on the server. The collector retains up to 200 statements per endpoint ranked by cumulative execution time; this is not every execution. Means are not percentiles. SQL is sensitive even when normalized. Activity samples can miss short queries; plans are disabled.";
    links = [
      {
        title = "Database health and collection errors";
        type = "link";
        url = "/d/macro-postgres";
      }
    ];
    templating.list = [
      {
        name = "database";
        label = "Database instance";
        type = "custom";
        query = "macro-db-dev,macro-db-dev-read-replica";
        current = {
          text = "macro-db-dev";
          value = "macro-db-dev";
        };
        options = [ ];
        multi = false;
        includeAll = false;
      }
      {
        name = "dbuser";
        label = "Database user";
        type = "query";
        datasource = prometheus;
        query = ''label_values(pg_stat_statements_calls_total{job="integrations/postgres",deployment_environment="dev",db_instance=~"$database",datname="macrodb"}, user)'';
        refresh = 1;
        multi = true;
        includeAll = true;
        allValue = ".*";
        current = {
          text = "All";
          value = "$__all";
        };
        options = [ ];
      }
      {
        name = "top";
        label = "Query rows";
        type = "custom";
        query = "20,50,100,200";
        current = {
          text = "20";
          value = "20";
        };
        options = [ ];
        multi = false;
        includeAll = false;
      }
      {
        name = "queryid";
        label = "Query ID";
        type = "query";
        datasource = prometheus;
        query = ''label_values(pg_stat_statements_calls_total{job="integrations/postgres",deployment_environment="dev",db_instance=~"$database",datname="macrodb"}, queryid)'';
        refresh = 1;
        multi = false;
        includeAll = true;
        allValue = ".*";
        current = {
          text = "All";
          value = "$__all";
        };
        options = [ ];
      }
    ];
    panels = [
      (summary 11 "Observed execution time" "sum(${timeTotals})" "s" 0)
      (summary 12 "Estimated calls" "sum(${callTotals})" "short" 6)
      (summary 13 "Average time per call" "1000 * sum(${timeTotals}) / (sum(${callTotals}) > 0)" "ms" 12)
      (summary 14 "Query shapes observed in period" "count(${callTotals} > 0)" "short" 18)
      {
        id = 1;
        title = "Query overview — filter SQL, sort any metric, click a query ID";
        type = "table";
        datasource = {
          type = "datasource";
          uid = "-- Mixed --";
        };
        gridPos = {
          x = 0;
          y = 4;
          w = 24;
          h = 12;
        };
        description = "Query shapes ranked by observed execution time, bounded by the selected row limit. SQL column filters apply to these ranked rows. SQL is looked up near the end of the selected period and may be missing for evicted statements or collector outages. User filters apply to counters; identical query IDs across users are combined. Share is of the selected collected workload. Counter increases are extrapolated estimates, so call and row counts may be fractional. These are execution durations, not CPU time or latency percentiles.";
        targets = [
          (instant "A" ranking)
          (instant "B" "${callTotals} and on(queryid) ${ranking}")
          (instant "C" "(1000 * ${timeTotals} / (${callTotals} > 0)) and on(queryid) ${ranking}")
          (instant "D" "100 * ${ranking} / scalar(sum(${timeTotals}))")
          (instant "E" "${rowTotals} and on(queryid) ${ranking}")
          {
            refId = "SQL";
            datasource = loki;
            queryType = "instant";
            expr = ''topk by (queryid) (1, sum by (queryid, querytext) (count_over_time({${logs},op="query_association"} | logfmt | queryid=~"$queryid" | querytext!="" | __error__="" [5m])))'';
          }
        ];
        transformations = [
          {
            id = "labelsToFields";
            options.mode = "columns";
          }
          {
            id = "joinByField";
            options = {
              byField = "queryid";
              mode = "outerTabular";
            };
          }
          {
            id = "filterByValue";
            options = {
              type = "include";
              match = "all";
              filters = [
                {
                  fieldName = "Value #A";
                  config.id = "isNotNull";
                }
              ];
            };
          }
          {
            id = "organize";
            options = {
              excludeByName = {
                Time = true;
                "Time 1" = true;
                "Time 2" = true;
                "Time 3" = true;
                "Time 4" = true;
                "Time 5" = true;
                "Time 6" = true;
                "Value #SQL" = true;
              };
              indexByName = {
                queryid = 0;
                querytext = 1;
                "Value #A" = 2;
                "Value #D" = 3;
                "Value #B" = 4;
                "Value #C" = 5;
                "Value #E" = 6;
              };
              renameByName = {
                querytext = "SQL";
                "Value #A" = "Execution time";
                "Value #B" = "Calls";
                "Value #C" = "Average time";
                "Value #D" = "Workload share";
                "Value #E" = "Rows";
              };
            };
          }
        ];
        options = {
          showHeader = true;
          sortBy = [
            {
              displayName = "Execution time";
              desc = true;
            }
          ];
        };
        fieldConfig = {
          defaults = {
            custom = {
              filterable = true;
              cellOptions.type = "auto";
            };
            noValue = "—";
          };
          overrides = [
            (field "queryid" [
              {
                id = "custom.width";
                value = 200;
              }
              {
                id = "links";
                value = [
                  {
                    title = "Investigate query";
                    url = "/d/macro-postgres-queries?var-database=$database&\${dbuser:queryparam}&var-top=$top&var-queryid=\${__value.raw}&\${__url_time_range}";
                  }
                ];
              }
            ])
            (field "SQL" [
              {
                id = "custom.width";
                value = 500;
              }
              {
                id = "custom.cellOptions";
                value = {
                  type = "auto";
                  wrapText = true;
                };
              }
            ])
            (field "Execution time" [ (unit "s") ])
            (field "Average time" [ (unit "ms") ])
            (field "Workload share" [ (unit "percent") ])
            (field "Calls" [
              (unit "short")
              {
                id = "decimals";
                value = 0;
              }
            ])
            (field "Rows" [
              (unit "short")
              {
                id = "decimals";
                value = 0;
              }
            ])
          ];
        };
      }
      (metric 2 "Average execution time per call"
        "1000 * rate(pg_stat_statements_seconds_total{${selector}}[$__rate_interval]) / (rate(pg_stat_statements_calls_total{${selector}}[$__rate_interval]) > 0)"
        "ms"
      )
      (metric 3 "Calls per second" "rate(pg_stat_statements_calls_total{${selector}}[$__rate_interval])"
        "ops"
      )
      (metric 4 "Rows per call"
        "rate(pg_stat_statements_rows_total{${selector}}[$__rate_interval]) / (rate(pg_stat_statements_calls_total{${selector}}[$__rate_interval]) > 0)"
        "short"
      )
      (
        (metric 5 "Block read time per second"
          "rate(pg_stat_statements_block_read_seconds_total{${selector}}[$__rate_interval])"
          "s"
        )
        // {
          description = "Requires track_io_timing on the database; zero can mean timing is disabled. This PR does not change that setting.";
        }
      )
      (metric 6 "Block write time per second"
        "rate(pg_stat_statements_block_write_seconds_total{${selector}}[$__rate_interval])"
        "s"
      )
      (logPanel 7 "Normalized SQL for selected queries"
        ''{${logs},op="query_association"} | logfmt | queryid=~"$queryid" | __error__="" | line_format "{{.queryid}}: {{.querytext}}"''
      )
      (
        (logPanel 8 "Sampled query activity"
          ''{${logs},op="query_sample"} | logfmt | user=~"''${dbuser:regex}" | queryid=~"$queryid" | __error__=""''
        )
        // {
          description = "Activity sampled every 15 seconds, emitted when an observed query ends or changes state. Raw SQL is omitted. These records do not represent every execution.";
        }
      )
      (logPanel 9 "Sampled waits and blocking sessions"
        ''{${logs},op="wait_event"} | logfmt | user=~"''${dbuser:regex}" | queryid=~"$queryid" | __error__=""''
      )
      (
        (logPanel 10 "Query collector health checks" ''{${logs},op="health_status"}'')
        // {
          description = "Hourly upstream checks, including requirements for features we leave disabled. Also inspect database health: a healthy metric exporter alone does not prove query-detail collection works.";
        }
      )
      (
        (metric 15 "Observed wait events per minute"
          ''sum by (wait_event_type) (count_over_time({${logs},op="wait_event"} | logfmt | user=~"''${dbuser:regex}" | queryid=~"$queryid" | wait_event_type!="" | __error__="" [1m]))''
          "short"
        )
        // {
          datasource = loki;
          gridPos = {
            x = 0;
            y = 61;
            w = 12;
            h = 9;
          };
          targets = [
            {
              refId = "A";
              queryType = "range";
              expr = ''sum by (wait_event_type) (count_over_time({${logs},op="wait_event"} | logfmt | user=~"''${dbuser:regex}" | queryid=~"$queryid" | wait_event_type!="" | __error__="" [1m]))'';
              legendFormat = "{{wait_event_type}}";
            }
          ];
          description = "Counts emitted wait observations. This is not time-weighted database load or a count of every wait. Short waits may be missed.";
        }
      )
      (
        (logPanel 16 "Observed blocking chains — blocked session and blocker PIDs"
          ''{${logs},op="wait_event"} | logfmt | user=~"''${dbuser:regex}" | queryid=~"$queryid" | blocked_by_pids!="[]" | blocked_by_pids!="" | __error__="" | line_format "Query {{.queryid}} · blocked PID {{.pid}} · blockers {{.blocked_by_pids}} · {{.wait_event_type}}/{{.wait_event}} · observed wait {{.wait_time}}"''
        )
        // {
          gridPos = {
            x = 12;
            y = 61;
            w = 12;
            h = 9;
          };
          description = "Historical sampled blocking relationships, emitted when observed activity changes or ends. Not a live list of all sessions.";
        }
      )
    ];
  };
in
{
  services.grafana.provision.dashboards.settings.providers = [
    {
      name = "macro-postgres-queries";
      orgId = 1;
      folder = "Macro";
      type = "file";
      disableDeletion = true;
      allowUiUpdates = false;
      options.path = pkgs.linkFarm "macro-postgres-queries-dashboard" [
        {
          name = "postgres-queries.json";
          path = pkgs.writeText "postgres-queries.json" (builtins.toJSON dashboard);
        }
      ];
    }
  ];
}
