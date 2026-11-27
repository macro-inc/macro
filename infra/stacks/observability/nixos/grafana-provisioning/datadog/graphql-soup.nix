# infra/stacks/monitoring/monitors/graphql-soup.ts
{ q, ... }:
{
  source = "monitors/graphql-soup.ts";
  interval = "5m";
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
    }
  ];
}
