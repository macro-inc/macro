# infra/stacks/monitoring/monitors/ses.ts
{ q, ... }:
let
  ses = metricName: statistic: {
    id = "ses";
    reducer = if statistic == "Sum" then "sum" else "mean";
    query = q.cloudwatch {
      namespace = "AWS/SES";
      inherit metricName statistic;
    };
  };
  monitor =
    attrs:
    {
      route = "page";
      environment = "prod";
      service = "ses";
      window = 3600;
      delay = 900;
      comparator = ">";
    }
    // attrs;
in
{
  source = "monitors/ses.ts";
  interval = "5m";
  monitors = [
    (monitor {
      monitor = "ses-complaint-rate";
      datadogId = 4178105;
      name = "[SES] Complaint Rate Increasing";
      inputs = [ (ses "Reputation.ComplaintRate" "Average") ];
      critical = 0.005;
      translation = "The account's reputation metric, the only SES account Datadog reads: 0.0047 in both when compared.";
    })
    (monitor {
      monitor = "ses-bounce-rate";
      datadogId = 1333601;
      name = "[SES] Bounce Rate Increasing";
      inputs = [ (ses "Reputation.BounceRate" "Average") ];
      critical = 0.05;
      warning = 0.03;
      translation = "The account's reputation metric: 0.0247 here when Datadog showed 0.0246.";
    })
    (monitor {
      monitor = "ses-high-email-sends";
      datadogId = 4757927;
      name = "[SES] HIGH EMAIL SENDS";
      inputs = [ (ses "Send" "Sum") ];
      critical = 250;
      warning = 200;
      translation = "Sends summed over the hour, as Datadog's `sum(last_1h)` of per-minute sums.";
    })
  ];
}
