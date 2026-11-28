# infra/stacks/monitoring/monitors/rds.ts
{ lib, q }:
let
  # Allocated storage in GiB (`aws rds describe-db-instances`), for Datadog's
  # `aws.rds.total_storage_space`, which comes from the RDS API: CloudWatch
  # has no such metric. Storage autoscaling (macro-db-prod and its replica up
  # to 10000 GiB, macro-db-dev and its replica up to 100) raises it without
  # this file changing.
  allocated = {
    us-east-1 = {
      fusionauth-db-dev = 20;
      fusionauthdb-prod = 50;
      macro-connect-dev-db = 20;
      macro-connect-prod-db = 20;
      macro-db-dev = 100;
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
    comparison = "Replay, 2026-11-13 05:00 to 11-28 00:00 UTC: macro-db-prod and its replica warned from 11-27 00:52 and 00:21 in Datadog and a minute later in Grafana, and were still warning at the end; the other six instances fired in neither. macro-db-dev grew from 50 to 100 GiB in five storage autoscaling steps on 11-26 and 11-27 (Datadog's `aws.rds.total_storage_space`), and Datadog warned for 3 to 5½ hours each time, ending 1 to 1¾ hours after the resize. A fixed size can't follow that: replayed with 100 GiB throughout, Grafana reads the instance fuller than it was, in warning or critical for 52 of the last 58 hours (19 of them critical) against Datadog's 23 in warning. Replayed dividing by Datadog's size at each hour instead, Grafana's five episodes start a minute after Datadog's, and the four that end inside the window end 2 to 4 minutes after; but Grafana reads critical for 38 to 61 minutes around each resize (known only to the hour), while the hour's average still holds free space from before it. macro-db-dev is now at 100 GiB, its autoscaling maximum, so its size here holds; macro-db-prod and both replicas can still grow past theirs. Live, 2026-11-27 23:43 to 11-28 00:48 UTC: from the first evaluation Grafana warned on the same three instances as Datadog; macro-db-dev recovered at 00:02 in Grafana (still dividing by 90 GiB) and 00:09 in Datadog, and at 00:48 both warn on macro-db-prod and its replica.";
  };
in
{
  source = "monitors/rds.ts";
  interval = "1m";
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
            # Over the series that reported: AVG counts a gap as 0.
            expression = "SUM(SEARCH('Namespace=\"AWS/RDS\" MetricName=\"DatabaseConnections\" ProxyName=\"macrodb-proxy-prod\" TargetGroup=\"default\"', 'Sum', 60)) / DATAPOINT_COUNT(SEARCH('Namespace=\"AWS/RDS\" MetricName=\"DatabaseConnections\" ProxyName=\"macrodb-proxy-prod\" TargetGroup=\"default\"', 'Sum', 60))";
          };
        }
      ];
      window = 3600;
      delay = 900;
      comparator = ">";
      critical = 500;
      translation = "Datadog's `aws.rds.proxy.database_connections` is CloudWatch's per-minute Sum (not Average) of each of the proxy's target series (read-write role, read-only role, target), averaged across the ones that reported each minute (CloudWatch's `AVG` would count a gap as 0): about 54 when Datadog showed 54.08.";
      comparison = "Replay, 2026-11-13 05:00 to 11-28 00:00 UTC: fired in neither. Live, 2026-11-27 23:43 to 11-28 00:48 UTC: Grafana's rule errored on every evaluation until its metric math query got a statistic (Grafana refuses a CloudWatch query without one). Since that reached Grafana at 2026-11-28 00:04, state history records no Error or NoData state for it, and neither system has fired.";
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
      comparison = "Replay, 2026-11-13 05:00 to 11-28 00:00 UTC: fired in neither, on either instance. Live, 2026-11-27 23:43 to 11-28 00:48 UTC: neither fired.";
    }
  ]
  ++ lib.concatLists (
    lib.mapAttrsToList (region: instances: lib.mapAttrsToList (storage region) instances) allocated
  );
}
