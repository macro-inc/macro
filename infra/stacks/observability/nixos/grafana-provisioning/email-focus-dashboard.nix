{ lib }:
let
  emailFocus = import ./email-focus.nix;
  datasource = {
    type = "cloudwatch";
    uid = "cloudwatch";
  };
  # Every worker metric reads the environment picked at the top.
  env = "$env";

  thresholdSteps = check: [
    {
      color = "green";
      value = null;
    }
    {
      color = "orange";
      value = check.warning;
    }
    {
      color = "red";
      value = check.critical;
    }
  ];

  timeseries = id: title: description: unit: targets: gridPos: {
    inherit
      id
      title
      description
      gridPos
      datasource
      ;
    type = "timeseries";
    targets = map (target: target // { inherit datasource; }) targets;
    fieldConfig.defaults = { inherit unit; };
    options.legend = {
      displayMode = "list";
      placement = "bottom";
      showLegend = true;
    };
  };

  # A go/stop check: the value its rules read, with their thresholds dashed.
  checkPanel =
    check: gridPos:
    lib.recursiveUpdate
      (timeseries check.panelId check.title
        "${check.description} Each point covers ${toString (check.window / 60)} minutes, as rules ${check.uid}-warn (orange) and ${check.uid}-crit (red) read it in prod."
        check.unit
        (emailFocus.panelQueries env check)
        gridPos
      )
      {
        fieldConfig.defaults = {
          thresholds = {
            mode = "absolute";
            steps = thresholdSteps check;
          };
          custom.thresholdsStyle.mode = "dashed";
        };
      };

  # Two panels a line, from `y` down.
  grid = y: index: {
    x = lib.mod index 2 * 12;
    y = y + builtins.div index 2 * 8;
    w = 12;
    h = 8;
  };
  row = id: title: y: {
    inherit id title;
    type = "row";
    collapsed = false;
    panels = [ ];
    gridPos = {
      x = 0;
      inherit y;
      w = 24;
      h = 1;
    };
  };

  inherit (emailFocus) checks;
  checksHeight = (builtins.length checks + 1) / 2 * 8;
  contextY = 1 + checksHeight + 1;

  # What the checks don't show: volume, the database and the event stream.
  context = [
    (timeseries 101 "Enrolled inboxes" "Inboxes whose owner is in the rollout, at each minute's look."
      "short"
      [ (emailFocus.metric env "EnrolledInboxes" "Maximum" 300) ]
    )
    (timeseries 102 "Cost per day"
      "What Jev and the due date cost, at the usage journal's stored prices."
      "currencyUSD"
      [
        (
          emailFocus.metric env "JevCostUsd" "Sum" 86400
          // {
            id = "jev";
            refId = "Jev";
          }
        )
        (
          emailFocus.metric env "DueDateCostUsd" "Sum" 86400
          // {
            id = "due";
            refId = "Due";
          }
        )
      ]
    )
    (timeseries 103 "Tokens" "Input tokens include cached ones." "short" [
      (
        emailFocus.metric env "JevInputTokens" "Sum" 300
        // {
          id = "jevin";
          refId = "JevIn";
        }
      )
      (
        emailFocus.metric env "JevOutputTokens" "Sum" 300
        // {
          id = "jevout";
          refId = "JevOut";
        }
      )
      (
        emailFocus.metric env "DueDateInputTokens" "Sum" 300
        // {
          id = "duein";
          refId = "DueIn";
        }
      )
      (
        emailFocus.metric env "DueDateOutputTokens" "Sum" 300
        // {
          id = "dueout";
          refId = "DueOut";
        }
      )
    ])
    (timeseries 104 "Classifications and due dates"
      "Classifier calls, due date asks, and asks whose model answer the harness rejected (it cited text the thread doesn't have, so the thread got no date; not a failure)."
      "short"
      [
        (
          emailFocus.metric env "ClassifierCalls" "Sum" 300
          // {
            id = "calls";
            refId = "Calls";
          }
        )
        (
          emailFocus.metric env "DueDateCalls" "Sum" 300
          // {
            id = "dues";
            refId = "Dues";
          }
        )
        (
          emailFocus.metric env "DueDateRejected" "Sum" 300
          // {
            id = "rejected";
            refId = "Rejected";
          }
        )
      ]
    )
    (timeseries 105 "Top of tab filled (p95)"
      "From an inbox being found in the rollout to its last 3 days classified."
      "s"
      [ (emailFocus.metric env "BackfillTopFilledSeconds" "p95" 3600) ]
    )
    (timeseries 106 "MacroDB CPU" "The primary's CPU; the sweep and the backfills read it." "percent" [
      {
        refId = "A";
        region = "us-east-1";
        namespace = "AWS/RDS";
        metricName = "CPUUtilization";
        statistic = "Maximum";
        dimensions.DBInstanceIdentifier = [ "macro-db-prod" ];
        period = "300";
        matchExact = true;
        metricQueryType = 0;
        metricEditorMode = 0;
        queryMode = "Metrics";
      }
    ])
    (timeseries 107 "Event stream lag"
      "Offsets the email-focus consumer group is behind on its topic, from MSK. Empty if MSK does not report the group."
      "short"
      [
        {
          refId = "A";
          region = "us-east-1";
          namespace = "AWS/Kafka";
          metricName = "SumOffsetLag";
          statistic = "Maximum";
          dimensions = {
            "Cluster Name" = [ "${env}-macro-event-kafka-cluster" ];
            "Consumer Group" = [ "email-focus" ];
          };
          period = "300";
          matchExact = false;
          metricQueryType = 0;
          metricEditorMode = 0;
          queryMode = "Metrics";
        }
      ]
    )
    {
      id = 108;
      title = "Tab opens";
      type = "text";
      options = {
        mode = "markdown";
        content = "How often the Focus tab opens empty (go/stop: under 5% of opens) is in PostHog, from the web app's Focus tab events. Open it from the dashboard links above.";
      };
    }
  ];

  panels = [
    (row 100 "Go/stop" 0)
  ]
  ++ lib.imap0 (index: check: checkPanel check (grid 1 index)) checks
  ++ [ (row 200 "Context" (contextY - 1)) ]
  # A timeseries still takes its place; the text panel is given one.
  ++ lib.imap0 (
    index: panel:
    let
      gridPos = grid contextY index;
    in
    if builtins.isFunction panel then panel gridPos else panel // { inherit gridPos; }
  ) context;

  dashboard = {
    uid = emailFocus.dashboardUid;
    title = "Email Focus rollout";
    schemaVersion = 39;
    version = 1;
    editable = false;
    tags = [
      "macro"
      "email-focus"
    ];
    timezone = "browser";
    refresh = "1m";
    time = {
      from = "now-2d";
      to = "now";
    };
    description = "The Email Focus rollout's go/stop numbers, from the worker's CloudWatch metrics (Macro/EmailFocus) in us-east-1. Hold the next rollout step while any is orange or red. Runbook: docs/runbooks/email-focus.md.";
    templating.list = [
      {
        name = "env";
        label = "Environment";
        type = "custom";
        query = "prod,dev";
        current = {
          text = "prod";
          value = "prod";
        };
        options = [ ];
      }
    ];
    links = [
      {
        title = "PostHog: Focus tab opens";
        type = "link";
        url = "https://us.posthog.com/";
        targetBlank = true;
      }
      {
        title = "Runbook";
        type = "link";
        url = "https://github.com/macro-inc/macro/blob/main/docs/runbooks/${emailFocus.runbook}";
        targetBlank = true;
      }
    ];
    inherit panels;
  };
in
dashboard
