{ lib, pkgs, ... }:
let
  cloudwatch = {
    type = "cloudwatch";
    uid = "cloudwatch";
  };
  prometheus = {
    type = "prometheus";
    uid = "prometheus";
  };
  loki = {
    type = "loki";
    uid = "loki";
  };
  cwTarget = namespace: metric: dimensions: statistic: {
    refId = "A";
    region = "us-east-1";
    inherit namespace dimensions statistic;
    metricName = metric;
    metricQueryType = 0;
    metricEditorMode = 0;
    queryMode = "Metrics";
    matchExact = true;
    period = "300";
  };
  panel = id: title: datasource: targets: unit: {
    inherit
      id
      title
      datasource
      targets
      ;
    type = "timeseries";
    gridPos = {
      x = if lib.mod (id - 1) 2 == 0 then 0 else 12;
      y = ((id - 1) / 2) * 8;
      w = 12;
      h = 8;
    };
    fieldConfig.defaults = { inherit unit; };
  };
  dashboard = uid: title: panels: {
    inherit uid title panels;
    schemaVersion = 39;
    version = 1;
    editable = false;
    tags = [
      "macro"
      "migration"
    ];
    timezone = "browser";
    refresh = "1m";
    time = {
      from = "now-6h";
      to = "now";
    };
  };
  applications = dashboard "macro-dev-telemetry" "Macro dev telemetry" [
    (panel 1 "Logs per second by service" loki [
      {
        refId = "A";
        expr = ''sum by (service_name) (rate({deployment_environment="dev"}[1m]))'';
      }
    ] "ops")
    (panel 2 "Error logs in five minutes" loki [
      {
        refId = "A";
        expr = ''sum by (service_name) (count_over_time({deployment_environment="dev"} | json parsed_level="level" | drop __error__, __error_details__ | parsed_level=~"(?i)error|fatal|critical" or severity_text=~"(?i)error|fatal|critical" [5m]))'';
      }
    ] "short")
    (panel 3 "Task CPU usage" prometheus [
      {
        refId = "A";
        expr = ''sum by (job) (ecs_task_cpu_usage_vcpu_vCPU{deployment_environment="dev"})'';
      }
    ] "short")
    (panel 4 "Task memory usage" prometheus [
      {
        refId = "A";
        expr = ''sum by (job) (ecs_task_memory_usage_Bytes{deployment_environment="dev"})'';
      }
    ] "bytes")
    (
      (panel 5 "Recent dev logs" loki [
        {
          refId = "A";
          expr = ''{deployment_environment="dev"}'';
        }
      ] "short")
      // {
        type = "logs";
        gridPos = {
          x = 0;
          y = 16;
          w = 24;
          h = 14;
        };
      }
    )
  ];
  database =
    (dashboard "macro-database" "Macro database and Lambda health" [
      (panel 1 "Database CPU" cloudwatch [
        (cwTarget "AWS/RDS" "CPUUtilization" { DBInstanceIdentifier = [ "$database" ]; } "Average")
      ] "percent")
      (panel 2 "Database connections" cloudwatch [
        (cwTarget "AWS/RDS" "DatabaseConnections" { DBInstanceIdentifier = [ "$database" ]; } "Average")
      ] "short")
      (panel 3 "Freeable memory" cloudwatch [
        (cwTarget "AWS/RDS" "FreeableMemory" { DBInstanceIdentifier = [ "$database" ]; } "Average")
      ] "bytes")
      (panel 4 "Free storage" cloudwatch [
        (cwTarget "AWS/RDS" "FreeStorageSpace" { DBInstanceIdentifier = [ "$database" ]; } "Average")
      ] "bytes")
      (panel 5 "Text extractor errors" cloudwatch [
        (cwTarget "AWS/Lambda" "Errors" { FunctionName = [ "document-text-extractor-dev" ]; } "Sum")
      ] "short")
      (panel 6 "Text extractor invocations" cloudwatch [
        (cwTarget "AWS/Lambda" "Invocations" { FunctionName = [ "document-text-extractor-dev" ]; } "Sum")
      ] "short")
    ])
    // {
      description = "Native AWS metrics. Query-level database monitoring and Datadog anomaly detection are separate migration work.";
      templating.list = [
        {
          name = "database";
          label = "Database";
          type = "custom";
          query = "macro-db-dev,macro-db-dev-read-replica,macro-db-prod,macro-db-prod-read-replica,fusionauth-db-dev,fusionauthdb-prod";
          current = {
            text = "macro-db-dev";
            value = "macro-db-dev";
          };
          options = [ ];
        }
      ];
    };
  files = pkgs.linkFarm "macro-grafana-dashboards" [
    {
      name = "dev.json";
      path = pkgs.writeText "dev.json" (builtins.toJSON applications);
    }
    {
      name = "database.json";
      path = pkgs.writeText "database.json" (builtins.toJSON database);
    }
  ];
in
{
  services.grafana.provision.dashboards.settings.providers = [
    {
      name = "macro";
      orgId = 1;
      folder = "Macro";
      type = "file";
      disableDeletion = true;
      allowUiUpdates = false;
      options.path = files;
    }
  ];
}
