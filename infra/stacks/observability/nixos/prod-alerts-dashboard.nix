{ lib, pkgs, ... }:
let
  prodAlerts = import ./prod-alerts.nix;
  datasource = {
    type = "cloudwatch";
    uid = "cloudwatch";
  };

  # Threshold steps colour a value from the step it reaches upwards.
  thresholdSteps =
    alert:
    if alert.firesWhen == "above" then
      [
        {
          color = "green";
          value = null;
        }
        {
          color = "orange";
          value = alert.warning;
        }
        {
          color = "red";
          value = alert.critical;
        }
      ]
    else
      [
        {
          color = "red";
          value = null;
        }
        {
          color = "orange";
          value = alert.critical;
        }
        {
          color = "green";
          value = alert.warning;
        }
      ];

  panel = alert: gridPos: {
    id = alert.panelId;
    inherit (alert) title;
    inherit datasource gridPos;
    type = "timeseries";
    description = "Alerts on the ${alert.reducer} over ${toString (alert.window / 60)} minutes: warning (orange) and critical (red). Rules ${alert.uid}-warn and ${alert.uid}-crit.";
    targets = [ (prodAlerts.cloudwatchQuery alert.metric // { inherit datasource; }) ];
    fieldConfig.defaults = {
      inherit (alert) unit;
      thresholds = {
        mode = "absolute";
        steps = thresholdSteps alert;
      };
      custom.thresholdsStyle.mode = "dashed";
    };
    options.legend = {
      displayMode = "list";
      placement = "bottom";
      showLegend = true;
    };
  };

  # A row header, then two panels per line.
  rowPanels =
    y: row:
    [
      {
        inherit (row) id title;
        type = "row";
        collapsed = false;
        panels = [ ];
        gridPos = {
          x = 0;
          inherit y;
          w = 24;
          h = 1;
        };
      }
    ]
    ++ lib.imap0 (
      index: alert:
      panel alert {
        x = lib.mod index 2 * 12;
        y = y + 1 + builtins.div index 2 * 8;
        w = 12;
        h = 8;
      }
    ) row.alerts;
  rowHeight = row: 1 + (builtins.length row.alerts + 1) / 2 * 8;
  panels =
    (lib.foldl'
      (layout: row: {
        y = layout.y + rowHeight row;
        panels = layout.panels ++ rowPanels layout.y row;
      })
      {
        y = 0;
        panels = [ ];
      }
      prodAlerts.rows
    ).panels;

  dashboard = {
    uid = prodAlerts.dashboardUid;
    title = "Prod alerts";
    schemaVersion = 39;
    version = 1;
    editable = false;
    tags = [
      "macro"
      "prod"
      "alerts"
    ];
    timezone = "browser";
    refresh = "1m";
    time = {
      from = "now-6h";
      to = "now";
    };
    description = "One panel per prod alert rule in nixos/alerting.nix, with its warning and critical thresholds. Alert notifications link to the panel that fired. Reads CloudWatch in us-east-1.";
    inherit panels;
  };
in
{
  services.grafana.provision.dashboards.settings.providers = [
    {
      name = "macro-prod-alerts";
      orgId = 1;
      folder = "Macro";
      type = "file";
      disableDeletion = true;
      allowUiUpdates = false;
      options.path = pkgs.linkFarm "macro-prod-alerts-dashboard" [
        {
          name = "prod-alerts.json";
          path = pkgs.writeText "prod-alerts.json" (builtins.toJSON dashboard);
        }
      ];
    }
  ];
}
