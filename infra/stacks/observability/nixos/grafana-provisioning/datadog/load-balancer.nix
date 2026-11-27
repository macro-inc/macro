# infra/stacks/monitoring/monitors/load-balancer.ts
{ q, ... }:
let
  # Datadog's `level:prod OR environment:prod*` load balancers, by region:
  # the ones it evaluated when this was written.
  prod = {
    us-east-1 = [
      "app/authentication-service-alb-prod/c238552e2c16f0e5"
      "app/convert-service-alb-prod/48ced5a77f1728bc"
      "app/document-processing-alb-prod/868781496a437fe3"
      "app/fusionauth-alb-prod/a700e4b7eedde8bc"
      "app/macro-compare-service-lb/1403c0c4572b1193"
      "app/macro-connect-prod-alb-6b22a57/41074eb7b1361a9b"
      "app/macro-convert-service-lb/6ea37176f7f205ca"
      "app/macro-gql-service-lb-prod/56da482c282f5e77"
      "app/prod-gateway-alb/8e99d35bdc70b1c9"
      "app/pvgw-http-prod-c1f9698/a8ce0455a73fcc7b"
      "app/static-file-service-alb-prod/1fb34755c33ec300"
    ];
    us-east-2 = [ "app/observability-a77ca6f/fbcdce04c386aea2" ];
  };
  count = region: metricName: id: {
    inherit id;
    reducer = "sum";
    query = q.cloudwatch {
      inherit region metricName;
      namespace = "AWS/ApplicationELB";
      dimensions.LoadBalancer = prod.${region};
      statistic = "Sum";
    };
  };
  non200 = region: {
    monitor = "alb-non-200-responses";
    part = region;
    datadogId = 1062605;
    route = "page";
    name = "[PROD] Load Balancer Non-200 Responses";
    environment = "prod";
    service = "alb";
    inputs = [
      (count region "HTTPCode_ELB_5XX_Count" "errors")
      (count region "RequestCount" "requests")
    ];
    value = "$errors / $requests * 100";
    window = 3600;
    delay = 900;
    comparator = ">";
    critical = 90;
    warning = 60;
    translation = "The load balancer's own 5xx (not its targets') as a share of its requests over the hour, per load balancer: Datadog's prod set when this was written, a rule per region. A load balancer with no 5xx has no datapoints, which is OK.";
  };
  # Every load balancer, as Datadog's `{*}`: dev too.
  healthy = region: {
    monitor = "alb-low-healthy-hosts";
    part = region;
    datadogId = 16891631;
    route = "page";
    name = "Application load balancer low healthy host count";
    environment = "prod";
    service = "alb";
    inputs = [
      {
        id = "healthy";
        reducer = "mean";
        query = q.metricsInsights {
          inherit region;
          sql = ''SELECT AVG(HealthyHostCount) FROM SCHEMA("AWS/ApplicationELB", AvailabilityZone, LoadBalancer, TargetGroup) GROUP BY LoadBalancer'';
        };
      }
    ];
    value = "abs($healthy)";
    window = 3600;
    delay = 900;
    comparator = "<=";
    critical = 0.25;
    translation = "Healthy hosts per target group and zone, averaged per load balancer as Datadog does (1.57 for prod-gateway-alb in both when compared), for every load balancer in the region, dev too, as Datadog's `{*}`; a rule per region. The series label is the load balancer.";
  };
in
{
  source = "monitors/load-balancer.ts";
  interval = "1m";
  monitors = [
    (healthy "us-east-1")
    (healthy "us-east-2")
    (non200 "us-east-1")
    (non200 "us-east-2")
  ];
}
