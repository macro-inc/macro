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
  interval = "1m";
  monitors = [
    (monitor {
      monitor = "ses-complaint-rate";
      datadogId = 4178105;
      name = "[SES] Complaint Rate Increasing";
      inputs = [ (ses "Reputation.ComplaintRate" "Average") ];
      critical = 0.005;
      translation = "The account's reputation metric, the only SES account Datadog reads: 0.0047 in both when compared.";
      comparison = "Replay, 2026-11-13 05:00 to 11-28 00:00 UTC: fired in neither. Live, 2026-11-27 23:43 to 11-28 00:48 UTC: neither fired.";
    })
    (monitor {
      monitor = "ses-bounce-rate";
      datadogId = 1333601;
      name = "[SES] Bounce Rate Increasing";
      inputs = [ (ses "Reputation.BounceRate" "Average") ];
      critical = 0.05;
      warning = 0.03;
      translation = "The account's reputation metric: 0.0247 here when Datadog showed 0.0246.";
      comparison = "Replay, 2026-11-13 05:00 to 11-28 00:00 UTC: both start in the warning Datadog opened on 2026-11-10 21:15 UTC; Datadog ended it at 11-16 15:18 and Grafana a minute later, and neither fired again. Live, 2026-11-27 23:43 to 11-28 00:48 UTC: neither fired.";
    })
    (monitor {
      monitor = "ses-high-email-sends";
      datadogId = 4757927;
      name = "[SES] HIGH EMAIL SENDS";
      inputs = [ (ses "Send" "Sum") ];
      critical = 250;
      warning = 200;
      translation = "Sends summed over the hour, as Datadog's `sum(last_1h)` of per-minute sums (`aws.ses.send.sum`). Datadog groups by account, but has SES data from one, the account Grafana reads, and only in us-east-1; CloudWatch has no SES sends in us-east-2, us-west-2 or eu-west-1: 37 in both when compared.";
      comparison = "Replay, 2026-11-13 05:00 to 11-28 00:00 UTC: Datadog warned twice on 11-20, at 22:29 for 3 minutes and at 22:36 for 7; Grafana warned a minute later each time, for the same lengths, and neither went critical. Live, 2026-11-27 23:43 to 11-28 00:48 UTC: neither fired.";
    })
  ];
}
