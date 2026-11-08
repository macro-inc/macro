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
    row
    ;

  readyTarget = quantile: legendFormat: {
    inherit legendFormat;
    expr = expand "1d" "quantile_over_time(${quantile}, $READY | unwrap seconds | __error__=\"\" [$RANGE]) by (start)";
  };

  dashboard = {
    uid = "macro-run-local";
    title = "Macro run_local";
    description = "Where `just run_local` time goes, from the opt-in local telemetry events in Loki (service_name=local-telemetry, kept 30 days). Set the range to a day or more for percentiles. A run's trace_id opens its step waterfall in Tempo, kept 7 days.";
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
      (lokiTable 4 "steps" (grid 0 13 12 12))
      (lokiTable 5 "services" (grid 12 13 12 12))
      (lokiTable 6 "failures" (grid 0 25 12 8))
      (lokiTable 7 "builds" (grid 12 25 12 8))
      (lokiTable 8 "actions" (grid 0 33 24 6))
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
