{ lib, pkgs, ... }:
let
  loki = {
    type = "loki";
    uid = "loki";
  };
  events = ''{service_name="github-actions"} | deployment_environment="ci" | json'';
  panel = id: title: expr: unit: {
    inherit id title;
    type = "timeseries";
    datasource = loki;
    gridPos = {
      x = if lib.mod (id - 1) 2 == 0 then 0 else 12;
      y = ((id - 1) / 2) * 8;
      w = 12;
      h = 8;
    };
    targets = [
      {
        refId = "A";
        inherit expr;
      }
    ];
    fieldConfig.defaults = { inherit unit; };
  };
  dashboard = {
    uid = "macro-ci";
    title = "Macro CI";
    description = "Completed GitHub Actions attempts and jobs. Events arrive after the entire workflow finishes; job duration excludes waiting. Open an event's GitHub URL for logs and steps.";
    schemaVersion = 39;
    version = 1;
    editable = false;
    tags = [
      "macro"
      "ci"
    ];
    timezone = "browser";
    refresh = "1m";
    time = {
      from = "now-24h";
      to = "now";
    };
    panels = [
      (panel 1 "Completed workflows by outcome"
        ''sum by (conclusion) (count_over_time(${events} | event_type="workflow" [$__interval]))''
        "short"
      )
      (panel 2 "Failed jobs by workflow"
        ''sum by (workflow) (count_over_time(${events} | event_type="job" | conclusion="failure" [$__interval]))''
        "short"
      )
      (panel 3 "Workflow duration p95"
        ''quantile_over_time(0.95, ${events} | event_type="workflow" | unwrap duration_seconds | __error__="" [1h]) by (workflow)''
        "s"
      )
      (panel 4 "Job execution duration p95"
        ''quantile_over_time(0.95, ${events} | event_type="job" | unwrap duration_seconds | __error__="" [1h]) by (workflow)''
        "s"
      )
      {
        id = 5;
        title = "Workflow and job activity — expand for GitHub links";
        type = "logs";
        datasource = loki;
        gridPos = {
          x = 0;
          y = 16;
          w = 24;
          h = 16;
        };
        targets = [
          {
            refId = "A";
            expr = events;
          }
        ];
        options = {
          showTime = true;
          wrapLogMessage = true;
          sortOrder = "Descending";
        };
      }
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
