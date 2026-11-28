# infra/stacks/monitoring/monitors/graphql-soup.ts
{ q, ... }:
{
  source = "monitors/graphql-soup.ts";
  interval = "1m";
  monitors = [
    {
      monitor = "graphql-soup-dss-5xx";
      datadogId = 23404593;
      route = "page";
      name = "[PROD] GraphQL soup: cloud-storage-service target group 5xx";
      environment = "prod";
      service = "cloud-storage-service";
      inputs = [
        {
          id = "errors";
          reducer = "sum";
          query = q.cloudwatch {
            namespace = "AWS/ApplicationELB";
            metricName = "HTTPCode_Target_5XX_Count";
            dimensions = {
              LoadBalancer = [ "app/prod-gateway-alb/8e99d35bdc70b1c9" ];
              TargetGroup = [ "targetgroup/prod-cloud-storage-service-tg/efcc30d4d72a4d50" ];
            };
            statistic = "Sum";
          };
        }
      ];
      window = 900;
      comparator = ">";
      critical = 25;
      warning = 10;
      translation = "The target group's 5xx count on prod-gateway-alb, its only load balancer, summed over 15 minutes. No 5xx means no datapoints, which is OK.";
      comparison = "Replay, 2026-11-13 05:00 to 11-28 00:00 UTC: each of Datadog's 129 warning or critical episodes overlaps a Grafana one, which starts a median minute earlier and ends a minute later, 106 of them within 5 minutes at both ends; 115 of Grafana's 118 overlap a Datadog one, and the other 3 lasted 1 to 2 minutes. Same state (OK, warning, critical) in 98.3% of minutes. Live, 2026-11-27 23:43 to 11-28 00:48 UTC: neither fired.";
    }
    {
      monitor = "graphql-soup-db-connections";
      datadogId = 23404592;
      route = "page";
      name = "[PROD] GraphQL soup: macro-db-prod connections high";
      environment = "prod";
      service = "macro-db-prod";
      inputs = [
        {
          id = "connections";
          reducer = "mean";
          query = q.cloudwatch {
            namespace = "AWS/RDS";
            metricName = "DatabaseConnections";
            dimensions.DBInstanceIdentifier = [ "macro-db-prod" ];
            statistic = "Average";
          };
        }
      ];
      window = 900;
      comparator = ">";
      critical = 1400;
      warning = 1100;
      translation = "The same CloudWatch metric Datadog reads. Datadog sees it after its AWS crawl, minutes late, and has no evaluation delay, so its last minutes are often empty; Grafana reads CloudWatch directly.";
      comparison = "Replay, 2026-11-13 05:00 to 11-28 00:00 UTC: 66 of Datadog's 70 warning episodes overlap one of Grafana's 52, which runs some of Datadog's short flaps together; they start and end a median 0 minutes apart, 48 within 5 minutes at both ends. Grafana missed four Datadog flaps of 1 to 3 minutes (11-18 17:33, 11-19 01:01, 11-24 12:17 and 12:20), and every Grafana episode overlaps a Datadog one. Same state in 99.6% of minutes, critical in neither. Live, 2026-11-27 23:43 to 11-28 00:48 UTC: neither fired.";
    }
  ];
}
