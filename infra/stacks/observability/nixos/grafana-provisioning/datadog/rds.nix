# infra/stacks/monitoring/monitors/rds.ts
{ lib, q }:
let
  # Allocated storage in GiB (`aws rds describe-db-instances`), for Datadog's
  # `aws.rds.total_storage_space`, which comes from the RDS API: CloudWatch
  # has no such metric. Storage autoscaling (macro-db-prod up to 10000 GiB,
  # macro-db-dev up to 100) raises it without this file changing.
  allocated = {
    us-east-1 = {
      fusionauth-db-dev = 20;
      fusionauthdb-prod = 50;
      macro-connect-dev-db = 20;
      macro-connect-prod-db = 20;
      macro-db-dev = 90;
      macro-db-dev-read-replica = 50;
      macro-db-prod = 5000;
      macro-db-prod-read-replica = 5000;
    };
    us-east-2.observability-grafana = 20;
  };
  storage = region: instance: gib: {
    monitor = "rds-storage-utilization";
    part = instance;
    datadogId = 6120132;
    route = "page";
    name = "[AWS] RDS Storage utilization is high";
    environment = "prod";
    service = instance;
    inputs = [
      {
        id = "free";
        reducer = "mean";
        query = q.cloudwatch {
          inherit region;
          namespace = "AWS/RDS";
          metricName = "FreeStorageSpace";
          dimensions.DBInstanceIdentifier = [ instance ];
          statistic = "Average";
        };
      }
    ];
    value = "100 - $free / (${toString gib} * 1073741824) * 100";
    window = 3600;
    delay = 900;
    comparator = ">";
    critical = 90;
    warning = 85;
    translation = "Datadog's `{*} by {dbinstanceidentifier,engine}` as a rule per instance, with its allocated storage written in rds.nix (${toString gib} GiB): CloudWatch has free space but not the total. Storage autoscaling makes that number stale.";
  };
in
{
  source = "monitors/rds.ts";
  interval = "5m";
  monitors = [
    {
      monitor = "rds-proxy-connections";
      datadogId = 1076524;
      route = "page";
      name = "[PROD] Excessive concurrent connections in rds proxy";
      environment = "prod";
      service = "macrodb-proxy-prod";
      inputs = [
        {
          id = "connections";
          reducer = "mean";
          query = q.cloudwatchMath {
            expression = "AVG(SEARCH('Namespace=\"AWS/RDS\" MetricName=\"DatabaseConnections\" ProxyName=\"macrodb-proxy-prod\" TargetGroup=\"default\"', 'Sum', 60))";
          };
        }
      ];
      window = 3600;
      delay = 900;
      comparator = ">";
      critical = 500;
      translation = "Datadog's `aws.rds.proxy.database_connections` is CloudWatch's per-minute Sum (not Average) of each of the proxy's target series (read-write role, read-only role, target), averaged across them: about 54 when Datadog showed 54.08.";
    }
    {
      monitor = "rds-high-cpu";
      datadogId = 1062630;
      route = "page";
      name = "[PROD] RDS High CPU Utilization";
      environment = "prod";
      service = "rds";
      inputs = [
        {
          id = "cpu";
          reducer = "mean";
          query = q.cloudwatch {
            namespace = "AWS/RDS";
            metricName = "CPUUtilization";
            dimensions.DBInstanceIdentifier = [
              "fusionauthdb-prod"
              "macro-db-prod"
            ];
            statistic = "Average";
          };
        }
      ];
      window = 3600;
      delay = 900;
      comparator = ">=";
      critical = 95;
      warning = 80;
      translation = "Datadog's `name:*-prod` as the instances it matches today, fusionauthdb-prod and macro-db-prod; an instance added later needs adding here.";
    }
  ]
  ++ lib.concatLists (
    lib.mapAttrsToList (region: instances: lib.mapAttrsToList (storage region) instances) allocated
  );
}
