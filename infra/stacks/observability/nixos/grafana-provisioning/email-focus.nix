# The Email Focus rollout's go/stop numbers, shared by the rules in
# alerting.nix and the panels in email-focus-dashboard.nix so a rule and its
# graph cannot drift apart.
#
# The worker publishes the metrics to CloudWatch as `Macro/EmailFocus`, by
# `Environment` (services/email_focus_worker/src/metrics.rs), once a minute;
# every counter goes out each minute, 0 when idle. Each check becomes a
# critical and a warning rule (`<uid>-crit`, `<uid>-warn`) in the "Email Focus"
# group and one panel. The rules notify through GoAlert and never page: they
# tell whoever runs the rollout to hold the next step. There are no Datadog
# copies; Grafana is where the rollout is watched.
#
# A check reads its `inputs` over its last `window` seconds, one value each,
# and combines them:
# - A rule queries each input on its own (Grafana sends each alert query to
#   CloudWatch separately, so CloudWatch metric math can't refer across them),
#   reduces it, and computes `value`, a Grafana math expression over `$<id>`.
#   Each query's period is the window and its range a minute shorter, so
#   CloudWatch returns one datapoint covering the window: a longer range would
#   add a partial bucket for the current minute.
# - A window with no datapoints (a percentile with no samples, or a sample
#   not yet published) gives no value and fires nothing, except the critical
#   rule of a check with `noData = "Alerting"`. A check's optional `floor`, a
#   math expression over its inputs, must hold too for either rule to fire.
# - A panel draws `expression`, the same value in CloudWatch metric math over
#   the inputs' ids, one point per window. A one-input check draws the input.
let
  namespace = "Macro/EmailFocus";

  # One worker metric over `period` seconds. `id` names it in expressions, and
  # starts lower case as CloudWatch requires.
  query =
    env: period:
    {
      id,
      metricName,
      statistic,
    }:
    {
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
    };

  # The CloudWatch queries a panel draws for `check` in `env`.
  panelQueries =
    env: check:
    if check ? expression then
      map (input: query env check.window input // { hide = true; }) check.inputs
      ++ [
        {
          refId = "A";
          id = "value";
          inherit (check) expression;
          # Grafana's CloudWatch queries carry a statistic even for math.
          statistic = "Sum";
          region = "us-east-1";
          period = toString check.window;
          metricQueryType = 0;
          metricEditorMode = 1;
          queryMode = "Metrics";
        }
      ]
    else
      [ (query env check.window (builtins.head check.inputs) // { refId = "A"; }) ];

  # A worker metric for a context panel, every `period` seconds.
  metric =
    env: metricName: statistic: period:
    query env period {
      id = "a";
      inherit metricName statistic;
    }
    // {
      refId = "A";
    };

  checks = [
    {
      panelId = 1;
      uid = "email-focus-cost";
      title = "Email Focus cost per enrolled inbox per day";
      unit = "currencyUSD";
      window = 86400;
      firesWhen = "above";
      warning = 0.02;
      critical = 0.03;
      inputs = [
        {
          id = "jev";
          metricName = "JevCostUsd";
          statistic = "Sum";
        }
        {
          id = "due";
          metricName = "DueDateCostUsd";
          statistic = "Sum";
        }
        {
          id = "enrolled";
          metricName = "EnrolledInboxes";
          statistic = "Maximum";
        }
      ];
      value = "($jev + $due) / ($enrolled + ($enrolled == 0))";
      expression = "(jev + due) / IF(enrolled > 0, enrolled, 1)";
      description = "Jev and the due date cost {{ humanize $values.B.Value }} dollars per enrolled inbox over the last day. The go/stop number is at most 0.03. The day a rollout step's inboxes are backfilled costs more.";
    }
    {
      panelId = 2;
      uid = "email-focus-classifier-failures";
      title = "Email Focus classifier unavailable or rejecting";
      unit = "percent";
      window = 3600;
      firesWhen = "above";
      warning = 0.5;
      critical = 1;
      inputs = [
        {
          id = "unavailable";
          metricName = "ClassifierUnavailable";
          statistic = "Sum";
        }
        {
          id = "rejected";
          metricName = "ClassifierRejected";
          statistic = "Sum";
        }
        {
          id = "calls";
          metricName = "ClassifierCalls";
          statistic = "Sum";
        }
      ];
      value = "100 * ($unavailable + $rejected) / ($calls + ($calls == 0))";
      # One failed call in a quiet hour reads as 100%.
      floor = "$unavailable + $rejected >= 3";
      expression = "IF(calls > 0, 100 * (unavailable + rejected) / calls, 0)";
      description = "{{ humanize $values.B.Value }}% of classifier calls in the last hour found it unavailable or were rejected, at least 3 of them. The go/stop number is under 1%. Unavailable threads are retried by the next sweep.";
    }
    {
      panelId = 3;
      uid = "email-focus-due-date-failures";
      title = "Email Focus due dates failing";
      unit = "percent";
      window = 3600;
      firesWhen = "above";
      warning = 2.5;
      critical = 5;
      inputs = [
        {
          id = "failures";
          metricName = "DueDateFailures";
          statistic = "Sum";
        }
        {
          id = "calls";
          metricName = "DueDateCalls";
          statistic = "Sum";
        }
      ];
      value = "100 * $failures / ($calls + ($calls == 0))";
      # One failed ask in a quiet hour reads as 100%.
      floor = "$failures >= 3";
      expression = "IF(calls > 0, 100 * failures / calls, 0)";
      description = "{{ humanize $values.B.Value }}% of due date asks to the agent harness failed or timed out in the last hour, at least 3 of them. The go/stop number is under 5%. A thread whose ask failed is stored without a date.";
    }
    {
      panelId = 4;
      uid = "email-focus-event-to-classified";
      title = "Email Focus mail waiting to be classified (p95)";
      unit = "s";
      window = 900;
      firesWhen = "above";
      warning = 60;
      critical = 120;
      inputs = [
        {
          id = "wait";
          metricName = "EventToClassifiedSeconds";
          statistic = "p95";
        }
      ];
      value = "$wait";
      description = "The 95th percentile from an email event to its thread's classification was {{ humanize $values.B.Value }} s over 15 minutes. The go/stop number is under 2 minutes.";
    }
    {
      panelId = 5;
      uid = "email-focus-sweep-duration";
      title = "Email Focus sweep running long";
      unit = "s";
      window = 7200;
      firesWhen = "above";
      warning = 900;
      critical = 1800;
      inputs = [
        {
          id = "sweep";
          metricName = "SweepSeconds";
          statistic = "Maximum";
        }
      ];
      value = "$sweep";
      description = "A sweep in the last 2 hours took {{ humanize $values.B.Value }} s. The go/stop number is under 30 minutes; sweeps run hourly.";
    }
    {
      panelId = 6;
      uid = "email-focus-sweep-failures";
      title = "Email Focus sweeps failing";
      unit = "short";
      window = 7200;
      firesWhen = "above";
      warning = 0;
      critical = 1;
      inputs = [
        {
          id = "failures";
          metricName = "SweepFailures";
          statistic = "Sum";
        }
      ];
      value = "$failures";
      description = "{{ humanize $values.B.Value }} sweeps failed in the last 2 hours. The go/stop number is none.";
    }
    {
      panelId = 7;
      uid = "email-focus-backfill-time";
      title = "Email Focus new inbox backfill time (p95)";
      unit = "s";
      window = 3600;
      firesWhen = "above";
      warning = 600;
      critical = 900;
      inputs = [
        {
          id = "filled";
          metricName = "BackfillFilledSeconds";
          statistic = "p95";
        }
      ];
      value = "$filled";
      description = "The 95th percentile from an inbox joining the rollout to its whole window filled was {{ humanize $values.B.Value }} s over the last hour. The go/stop number is under 15 minutes. Inboxes the worker finds at its start are not timed.";
    }
    {
      panelId = 8;
      uid = "email-focus-stale-threads";
      title = "Email Focus stale-thread read slow (p95)";
      unit = "s";
      window = 3600;
      firesWhen = "above";
      warning = 0.3;
      critical = 0.5;
      inputs = [
        {
          id = "read";
          metricName = "StaleThreadsSeconds";
          statistic = "p95";
        }
      ];
      value = "$read";
      description = "The 95th percentile of one stale-thread page read was {{ humanize $values.B.Value }} s over the last hour. The go/stop number is under 500 ms; a slower read means the sweep and backfill load MacroDB.";
    }
    {
      panelId = 9;
      uid = "email-focus-restarts";
      title = "Email Focus worker restarting";
      unit = "short";
      window = 1800;
      firesWhen = "above";
      warning = 2;
      critical = 3;
      inputs = [
        {
          id = "starts";
          metricName = "WorkerStarts";
          statistic = "Sum";
        }
      ];
      value = "$starts";
      # Starts are published every minute, so none for 30 minutes is a worker
      # that stopped publishing.
      noData = "Alerting";
      description = "The worker started {{ humanize $values.B.Value }} times in 30 minutes: a crash loop. A deploy starts it once or twice. With no value, the worker has published nothing for 30 minutes: it is down or stuck.";
    }
  ];
in
{
  inherit
    query
    panelQueries
    metric
    checks
    ;
  dashboardUid = "email-focus-rollout";
  runbook = "email-focus.md";
}
