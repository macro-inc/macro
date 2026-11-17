# The Email Focus rollout's go/stop numbers, shared by the rules in
# alerting.nix and the panels in email-focus-dashboard.nix so a rule and its
# graph cannot drift apart.
#
# The worker publishes the metrics to CloudWatch as `Macro/EmailFocus`, by
# `Environment` (services/email_focus_worker/src/metrics.rs). Each check becomes
# a critical and a warning rule (`<uid>-crit`, `<uid>-warn`) in the "Email
# Focus" group and one panel. The rules notify through GoAlert and never page:
# they tell whoever runs the rollout to hold the next step. There are no Datadog
# copies; Grafana is where the rollout is watched.
#
# `queries` are CloudWatch queries; the one with refId "A" is what the rule
# reduces and the panel draws, and the others are its inputs. `firesWhen`,
# `warning`, `critical`, `window` (seconds) and `reducer` work as in
# prod-alerts.nix.
let
  namespace = "Macro/EmailFocus";

  # A worker metric over `period` seconds, as an input to metric math.
  input = env: id: metricName: statistic: period: {
    refId = id;
    inherit
      id
      namespace
      metricName
      statistic
      ;
    region = "us-east-1";
    dimensions.Environment = [ env ];
    period = toString period;
    matchExact = true;
    metricQueryType = 0;
    metricEditorMode = 0;
    queryMode = "Metrics";
    hide = true;
  };
  # The value a check reads: metric math over its inputs.
  math = expression: period: {
    refId = "A";
    id = "a";
    inherit expression;
    region = "us-east-1";
    period = toString period;
    metricQueryType = 0;
    metricEditorMode = 1;
    queryMode = "Metrics";
  };
  # The value a check reads: one worker metric.
  metric =
    env: metricName: statistic: period:
    input env "a" metricName statistic period
    // {
      refId = "A";
      hide = false;
    };

  # A share of `calls`, in percent, and 0 when nothing was called. `failures`
  # maps a query id (lower case first, as CloudWatch requires) to its metric.
  failurePercent =
    env: calls: failures: period:
    let
      ids = builtins.attrNames failures;
    in
    map (id: input env id failures.${id} "Sum" period) ids
    ++ [
      (input env "calls" calls "Sum" period)
      (math "IF(calls > 0, 100 * (${builtins.concatStringsSep " + " (map (id: "FILL(${id}, 0)") ids)}) / calls, 0)" period)
    ];

  checks = env: [
    {
      panelId = 1;
      uid = "email-focus-cost";
      title = "Email Focus cost per enrolled inbox per day";
      unit = "currencyUSD";
      window = 86400;
      reducer = "last";
      firesWhen = "above";
      warning = 0.02;
      critical = 0.03;
      queries = [
        (input env "jev" "JevCostUsd" "Sum" 86400)
        (input env "due" "DueDateCostUsd" "Sum" 86400)
        (input env "enrolled" "EnrolledInboxes" "Maximum" 86400)
        (math "IF(enrolled > 0, (FILL(jev, 0) + FILL(due, 0)) / enrolled, 0)" 86400)
      ];
      description = "Jev and the due date cost {{ humanize $values.B.Value }} dollars per enrolled inbox over the last day. The go/stop number is at most 0.03.";
    }
    {
      panelId = 2;
      uid = "email-focus-classifier-failures";
      title = "Email Focus classifier unavailable or rejecting";
      unit = "percent";
      window = 3600;
      reducer = "last";
      firesWhen = "above";
      warning = 0.5;
      critical = 1;
      queries = failurePercent env "ClassifierCalls" {
        unavailable = "ClassifierUnavailable";
        rejected = "ClassifierRejected";
      } 3600;
      description = "{{ humanize $values.B.Value }}% of classifier calls in the last hour found it unavailable or were rejected. The go/stop number is under 1%. Unavailable threads are retried by the next sweep.";
    }
    {
      panelId = 3;
      uid = "email-focus-due-date-failures";
      title = "Email Focus due dates failing";
      unit = "percent";
      window = 3600;
      reducer = "last";
      firesWhen = "above";
      warning = 2.5;
      critical = 5;
      queries = failurePercent env "DueDateCalls" { failures = "DueDateFailures"; } 3600;
      description = "{{ humanize $values.B.Value }}% of due date asks to the agent harness failed or timed out in the last hour. The go/stop number is under 5%. A thread whose ask failed is stored without a date.";
    }
    {
      panelId = 4;
      uid = "email-focus-event-to-classified";
      title = "Email Focus mail waiting to be classified (p95)";
      unit = "s";
      window = 900;
      reducer = "last";
      firesWhen = "above";
      warning = 60;
      critical = 120;
      queries = [ (metric env "EventToClassifiedSeconds" "p95" 900) ];
      description = "The 95th percentile from an email event to its thread's classification was {{ humanize $values.B.Value }} s over 15 minutes. The go/stop number is under 2 minutes.";
    }
    {
      panelId = 5;
      uid = "email-focus-sweep-duration";
      title = "Email Focus sweep running long";
      unit = "s";
      window = 7200;
      reducer = "max";
      firesWhen = "above";
      warning = 900;
      critical = 1800;
      queries = [ (metric env "SweepSeconds" "Maximum" 3600) ];
      description = "A sweep took {{ humanize $values.B.Value }} s. The go/stop number is under 30 minutes; sweeps run hourly.";
    }
    {
      panelId = 6;
      uid = "email-focus-sweep-failures";
      title = "Email Focus sweeps failing";
      unit = "short";
      window = 7200;
      reducer = "last";
      firesWhen = "above";
      warning = 0;
      critical = 1;
      queries = [ (metric env "SweepFailures" "Sum" 7200) ];
      description = "{{ humanize $values.B.Value }} sweeps failed in the last 2 hours. The go/stop number is none.";
    }
    {
      panelId = 7;
      uid = "email-focus-backfill-time";
      title = "Email Focus new inbox backfill time (p95)";
      unit = "s";
      window = 3600;
      reducer = "last";
      firesWhen = "above";
      warning = 600;
      critical = 900;
      queries = [ (metric env "BackfillFilledSeconds" "p95" 3600) ];
      description = "The 95th percentile from an inbox being found in the rollout to its whole window filled was {{ humanize $values.B.Value }} s over the last hour. The go/stop number is under 15 minutes.";
    }
    {
      panelId = 8;
      uid = "email-focus-stale-threads";
      title = "Email Focus stale-thread read slow (p95)";
      unit = "s";
      window = 3600;
      reducer = "last";
      firesWhen = "above";
      warning = 0.3;
      critical = 0.5;
      queries = [ (metric env "StaleThreadsSeconds" "p95" 3600) ];
      description = "The 95th percentile of one stale-thread page read was {{ humanize $values.B.Value }} s over the last hour. The go/stop number is under 500 ms; a slower read means the sweep and backfill load MacroDB.";
    }
    {
      panelId = 9;
      uid = "email-focus-restarts";
      title = "Email Focus worker restarting";
      unit = "short";
      window = 1800;
      reducer = "last";
      firesWhen = "above";
      warning = 2;
      critical = 3;
      queries = [ (metric env "WorkerStarts" "Sum" 1800) ];
      description = "The worker started {{ humanize $values.B.Value }} times in 30 minutes: a crash loop. Deploys start it once or twice.";
    }
  ];
in
{
  inherit
    namespace
    input
    metric
    checks
    ;
  dashboardUid = "email-focus-rollout";
  runbook = "email-focus.md";
}
