{ lib, pkgs, ... }:
let
  # Shared with scripts/ci-report.ts --spec local, so the report and these panels agree.
  report = builtins.fromJSON (builtins.readFile ./local-report.json);
  inherit
    (import ./loki-report-panels.nix {
      inherit lib report;
    })
    expand
    grid
    lokiSeries
    lokiStat
    lokiTable
    lokiTableOf
    row
    ;

  readyTarget = quantile: legendFormat: {
    inherit legendFormat;
    expr = expand "1d" "quantile_over_time(${quantile}, $READY | unwrap seconds | __error__=\"\" [$RANGE]) by (start)";
  };

  loki = {
    type = "loki";
    uid = "loki";
  };
  tempo = {
    type = "tempo";
    uid = "tempo";
  };
  prometheus = {
    type = "prometheus";
    uid = "prometheus";
  };

  # The local stacks' own traces, logs and metrics, from machines whose local
  # telemetry settings say `services = true` (docs/development/running-locally.md).
  # Their forwarder tags everything `host.name` = the machine's name and
  # `deployment.environment` = local; their run events gain `host_name`.
  localTop = 40;
  machineFilter = ''host_name=~"$machine"'';
  serviceLogs = ''{deployment_environment="local", service_name!="local-telemetry"} | ${machineFilter}'';
  errorLogs = ''${serviceLogs} | severity_text=~"(?i)error|fatal|critical"'';
  bothLabels = "host_name, macro_local_instance";

  dashboard = {
    uid = "macro-run-local";
    title = "Macro run_local";
    description = "Where `just run_local` time goes, from the local telemetry events (on by default) in Loki (service_name=local-telemetry, kept 30 days). Set the range to a day or more for percentiles. A run's trace_id opens its step waterfall in Tempo, kept 7 days. The last row shows the local stacks' own traces and logs from machines that turned on `services = true`, filtered by the Machine variable.";
    schemaVersion = 39;
    version = 1;
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
      (row 100 0 "Time to ready, from Loki events")
      (lokiStat 1 "summary" (grid 0 1 24 4))
      (lokiTable 2 "ready" (grid 0 5 12 8))
      (lokiSeries 3 (grid 12 5 12 8) "Time to ready, rolling 24 h"
        "Each point covers the 24 hours before it, by fresh or resumed start."
        "s"
        "15m"
        [
          (readyTarget "0.5" "p50 {{start}}")
          (readyTarget "0.9" "p90 {{start}}")
        ]
        { }
      )
      # Full width: step names are long.
      (lokiTable 4 "steps" (grid 0 13 24 11))
      (lokiTable 5 "services" (grid 0 24 12 10))
      (lokiTable 7 "builds" (grid 12 24 12 5))
      (lokiTable 8 "actions" (grid 12 29 12 5))
      (lokiTable 6 "failures" (grid 0 34 24 6))

      (row 200 localTop "Local stacks by machine (`services = true`)")
      (lokiTableOf 20 {
        title = "Bring-ups by machine";
        description = "Bring-ups from machines that send their stacks' telemetry, by the machine's name.";
        by = [ "host_name" ];
        sort = "Runs";
        columns = [
          {
            name = "Runs";
            unit = "short";
            expr = "sum by (host_name) (count_over_time($RUN | ${machineFilter} [$RANGE]))";
          }
          {
            name = "Not ready";
            unit = "short";
            expr = "sum by (host_name) (count_over_time($STOPPED | ${machineFilter} [$RANGE]))";
          }
          {
            name = "Ready p50";
            unit = "s";
            expr = "quantile_over_time(0.5, $READY | ${machineFilter} | unwrap seconds | __error__=\"\" [$RANGE]) by (host_name)";
          }
          {
            name = "Ready p90";
            unit = "s";
            expr = "quantile_over_time(0.9, $READY | ${machineFilter} | unwrap seconds | __error__=\"\" [$RANGE]) by (host_name)";
          }
        ];
      } (grid 0 (localTop + 1) 12 8))
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
        description = "Machines whose local stacks sent metrics in the range: their `machine` setting or hostname.";
        type = "query";
        datasource = prometheus;
        query = ''label_values({deployment_environment="local"}, host_name)'';
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
    ];
  };
in
{
  services.grafana.provision.dashboards.settings.providers = [
    {
      name = "macro-run-local";
      orgId = 1;
      folder = "Macro";
      type = "file";
      disableDeletion = true;
      allowUiUpdates = false;
      options.path = pkgs.linkFarm "macro-run-local-dashboard" [
        {
          name = "run-local.json";
          path = pkgs.writeText "run-local.json" (builtins.toJSON dashboard);
        }
      ];
    }
  ];
}
