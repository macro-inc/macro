# Grafana alerting provisioning: contact points, the notification policy and
# the rule groups, as the three provisioning documents Grafana reads.
#
# `goalertUrl` is where Grafana reaches GoAlert's API, without a trailing slash.
# The contact points read `$GRAFANA_ALERT_TOPIC_ARN`, `$GOALERT_GRAFANA_KEY`
# and `$GOALERT_GRAFANA_NOTIFY_KEY` from Grafana's environment.
{ lib, goalertUrl }:
let
  lokiQuery = expr: {
    refId = "A";
    datasourceUid = "loki";
    relativeTimeRange = {
      from = 3600;
      to = 0;
    };
    model = {
      inherit expr;
      refId = "A";
      queryType = "instant";
      intervalMs = 1000;
      maxDataPoints = 43200;
    };
  };
  rule = uid: title: monitorId: query: severity: condition: {
    inherit uid title;
    condition = "C";
    for = "0s";
    noDataState = "OK";
    execErrState = "Error";
    # Enable after live source queries and notification delivery are verified.
    isPaused = true;
    labels = {
      environment = "dev";
      inherit severity;
      migration = "datadog";
    };
    annotations = {
      summary = title;
      datadog_url = "https://us5.datadoghq.com/monitors/${monitorId}";
      description = "Migrated threshold and window; Datadog remains active during validation.";
    };
    data = query ++ expressions "last" condition;
  };
  # Reduce query A to one value per series (B), then compare it (C).
  expressions = reducer: condition: [
    {
      refId = "B";
      datasourceUid = "__expr__";
      relativeTimeRange = {
        from = 0;
        to = 0;
      };
      model = {
        refId = "B";
        type = "reduce";
        expression = "A";
        inherit reducer;
      };
    }
    {
      refId = "C";
      datasourceUid = "__expr__";
      relativeTimeRange = {
        from = 0;
        to = 0;
      };
      model = {
        refId = "C";
        type = "math";
        expression = condition;
      };
    }
  ];

  # Prod rules: a critical and a warning rule per entry in prod-alerts.nix,
  # each linked to that entry's panel on the "Prod alerts" dashboard.
  prodAlerts = import ./prod-alerts.nix;
  prodRule =
    alert:
    {
      severity,
      condition,
    }:
    {
      uid = "${alert.uid}-${if severity == "critical" then "crit" else "warn"}";
      title = "[PROD] ${alert.title} (${severity})";
      condition = "C";
      for = "0s";
      # Sparse CloudWatch counters have no datapoints when idle.
      noDataState = "OK";
      execErrState = "Error";
      isPaused = false;
      labels = {
        environment = "prod";
        inherit severity;
        inherit (alert) service;
        # Only critical alerts page, through GoAlert.
        pages = lib.boolToString ((alert.pages or false) && severity == "critical");
      };
      # Grafana turns the dashboard and panel annotations into the panel link
      # in the rule view. GoAlert's details list annotations but not Grafana's
      # panel link, so `panel_url` repeats it. `externalURL` is the runtime
      # root_url; trim its trailing slash.
      annotations = {
        summary = alert.title;
        inherit (alert) description;
        runbook_url = "https://github.com/macro-inc/macro/blob/main/docs/runbooks/${alert.runbook}";
        panel_url = ''{{ reReplaceAll "/$" "" externalURL }}/d/${prodAlerts.dashboardUid}?viewPanel=${toString alert.panelId}'';
        __dashboardUid__ = prodAlerts.dashboardUid;
        __panelId__ = toString alert.panelId;
      };
      data = [
        {
          refId = "A";
          datasourceUid = "cloudwatch";
          relativeTimeRange = {
            from = alert.window;
            to = 0;
          };
          model = prodAlerts.cloudwatchQuery alert.metric;
        }
      ]
      ++ expressions alert.reducer condition;
    };
  # Warning and critical are mutually exclusive bands, as in the dev rules.
  #
  # A window with no datapoints reduces to NaN, not to no data, and a
  # comparison with NaN is NaN, which Grafana treats as firing; noDataState
  # never sees it. So each condition holds only for a number, and an entry
  # with `noData = "Alerting"` fires its critical rule on NaN too. An entry's
  # optional `floor`, a math expression over its inputs, must also hold.
  prodRulePairWith =
    makeRule: alert:
    let
      critical = builtins.toJSON alert.critical;
      warning = builtins.toJSON alert.warning;
      past = if alert.firesWhen == "above" then ">" else "<";
      within = if alert.firesWhen == "above" then "<=" else ">=";
      floor = lib.optionalString (alert ? floor) " && ${alert.floor}";
      criticalBand = "$B ${past} ${critical}${floor}";
    in
    [
      (makeRule alert {
        severity = "critical";
        condition =
          if (alert.noData or "OK") == "Alerting" then
            "!is_number($B) || ${criticalBand}"
          else
            "is_number($B) && ${criticalBand}";
      })
      (makeRule alert {
        severity = "warning";
        condition = "is_number($B) && $B ${past} ${warning} && $B ${within} ${critical}${floor}";
      })
    ];
  prodRules = lib.concatMap (
    row: lib.concatMap (prodRulePairWith prodRule) row.alerts
  ) prodAlerts.rows;

  # Email Focus rollout rules: the go/stop numbers in email-focus.nix, linked
  # to their panels on the "Email Focus rollout" dashboard. They notify and
  # never page.
  emailFocus = import ./email-focus.nix;
  focusRule =
    check:
    { severity, condition }:
    {
      uid = "${check.uid}-${if severity == "critical" then "crit" else "warn"}";
      title = "[PROD] ${check.title} (${severity})";
      condition = "C";
      for = "0s";
      # Every counter is published each minute, so no data means the worker
      # isn't publishing, or no samples for a percentile: nothing to judge.
      # The restarts check alone fires on it, as critical, for a worker that
      # stopped.
      noDataState = if severity == "critical" then check.noData or "OK" else "OK";
      execErrState = "Error";
      isPaused = false;
      labels = {
        environment = "prod";
        inherit severity;
        service = "email-focus-worker";
        pages = "false";
      };
      annotations = {
        summary = check.title;
        inherit (check) description;
        runbook_url = "https://github.com/macro-inc/macro/blob/main/docs/runbooks/${emailFocus.runbook}";
        panel_url = ''{{ reReplaceAll "/$" "" externalURL }}/d/${emailFocus.dashboardUid}?viewPanel=${toString check.panelId}'';
        __dashboardUid__ = emailFocus.dashboardUid;
        __panelId__ = toString check.panelId;
      };
      # Each input queried alone and reduced to its one value (see
      # email-focus.nix), then the check's value (B) and its threshold (C).
      data =
        map (input: {
          refId = "${input.id}_query";
          datasourceUid = "cloudwatch";
          relativeTimeRange = {
            from = check.window - 60;
            to = 0;
          };
          model = emailFocus.query "prod" check.window input // {
            refId = "${input.id}_query";
          };
        }) check.inputs
        ++ map (input: {
          refId = input.id;
          datasourceUid = "__expr__";
          relativeTimeRange = {
            from = 0;
            to = 0;
          };
          model = {
            refId = input.id;
            type = "reduce";
            expression = "${input.id}_query";
            reducer = "last";
          };
        }) check.inputs
        ++ [
          {
            refId = "B";
            datasourceUid = "__expr__";
            relativeTimeRange = {
              from = 0;
              to = 0;
            };
            model = {
              refId = "B";
              type = "math";
              expression = check.value;
            };
          }
          (lib.last (expressions "last" condition))
        ];
    };
  focusRules = lib.concatMap (prodRulePairWith focusRule) emailFocus.checks;
  dss = [
    (lokiQuery ''sum(count_over_time({service_name="cloud-storage-service",deployment_environment="dev"} |~ "(?i)\\berror\\w*" [5m]))'')
  ];
  invites = [
    (lokiQuery ''sum by (sender_id) (count_over_time({service_name="notification-service",deployment_environment="dev"} | json | notification_event_type="channel_invite" | message="processing message" | sender_id!="" | __error__="" [1h]))'')
  ];
  lambdaMetric = refId: id: metricName: {
    inherit refId;
    datasourceUid = "cloudwatch";
    relativeTimeRange = {
      from = 15300;
      to = 900;
    };
    model = {
      inherit refId id metricName;
      region = "us-east-1";
      namespace = "AWS/Lambda";
      dimensions.FunctionName = [ "document-text-extractor-dev" ];
      statistic = "Sum";
      period = "300";
      matchExact = true;
      metricQueryType = 0;
      metricEditorMode = 0;
      queryMode = "Metrics";
    };
  };
  extractor = [
    (lambdaMetric "Errors" "errors" "Errors")
    (lambdaMetric "Invocations" "invocations" "Invocations")
    {
      refId = "A";
      datasourceUid = "cloudwatch";
      relativeTimeRange = {
        from = 15300;
        to = 900;
      };
      model = {
        refId = "A";
        id = "error_ratio";
        statistic = "Sum";
        region = "us-east-1";
        expression = "IF(TIME_SERIES(SUM(invocations)) > 0, 100 * TIME_SERIES(SUM(errors)) / TIME_SERIES(SUM(invocations)), 0)";
        period = "300";
        metricQueryType = 0;
        metricEditorMode = 1;
        queryMode = "Metrics";
      };
    }
  ];
in
{
  contactPoints = {
    apiVersion = 1;
    # Grafana keeps removed provisioned contact points until told to delete
    # them. GoAlert now posts to the channel instead.
    deleteContactPoints = [
      {
        orgId = 1;
        uid = "macro-alerts";
      }
    ];
    contactPoints = [
      {
        orgId = 1;
        name = "Macro team email";
        receivers = [
          {
            uid = "macro-team-sns";
            type = "sns";
            disableResolveMessage = false;
            settings = {
              sigv4.region = "us-east-2";
              topic_arn = "$GRAFANA_ALERT_TOPIC_ARN";
            };
          }
        ];
      }
      {
        orgId = 1;
        name = "GoAlert";
        receivers = [
          {
            uid = "goalert";
            type = "webhook";
            disableResolveMessage = false;
            # GoAlert closes the alert when Grafana sends the resolved notification.
            settings = {
              url = "${goalertUrl}/api/v2/grafana/incoming?token=$GOALERT_GRAFANA_KEY";
              httpMethod = "POST";
            };
          }
        ];
      }
      {
        orgId = 1;
        name = "GoAlert notify";
        receivers = [
          {
            uid = "goalert-notify";
            type = "webhook";
            disableResolveMessage = false;
            # GoAlert's `Notify` service, whose policy posts to the channel.
            settings = {
              url = "${goalertUrl}/api/v2/grafana/incoming?token=$GOALERT_GRAFANA_NOTIFY_KEY";
              httpMethod = "POST";
            };
          }
        ];
      }
    ];
  };
  # Every prod alert goes to GoAlert, which posts it to the Macro Alerts
  # channel and re-posts until acknowledged. Paging criticals go to the
  # paging service, everything else to `Notify`. GoAlert dedups by alert
  # fingerprint, so repeats only refresh the open alert.
  policies = {
    apiVersion = 1;
    policies = [
      {
        orgId = 1;
        receiver = "GoAlert notify";
        group_by = [
          "grafana_folder"
          "alertname"
          "severity"
          "pages"
        ];
        group_wait = "30s";
        group_interval = "5m";
        repeat_interval = "4h";
        routes = [
          {
            receiver = "Macro team email";
            object_matchers = [
              [
                "environment"
                "="
                "dev"
              ]
            ];
          }
          {
            receiver = "GoAlert";
            object_matchers = [
              [
                "pages"
                "="
                "true"
              ]
              [
                "severity"
                "="
                "critical"
              ]
            ];
            repeat_interval = "1h";
          }
          {
            receiver = "GoAlert notify";
            object_matchers = [
              [
                "severity"
                "="
                "critical"
              ]
            ];
            repeat_interval = "1h";
          }
        ];
      }
    ];
  };
  rules = {
    apiVersion = 1;
    groups = [
      {
        orgId = 1;
        name = "Prod";
        folder = "Macro";
        interval = "1m";
        rules = prodRules;
      }
      {
        orgId = 1;
        name = "Email Focus";
        folder = "Macro";
        interval = "1m";
        rules = focusRules;
      }
      {
        orgId = 1;
        name = "Datadog dev migration";
        folder = "Macro";
        interval = "1m";
        rules = [
          (rule "dd-1291772-critical" "[DEV] Document text extractor failing" "1291772" extractor "critical"
            "$B > 80"
          )
          (rule "dd-1291772-warning" "[DEV] Document text extractor warning" "1291772" extractor "warning"
            "$B > 50 && $B <= 80"
          )
          (rule "dd-1013923-critical" "[DEV] Increased number of errors for DSS" "1013923" dss "critical"
            "$B > 200"
          )
          (rule "dd-1013923-warning" "[DEV] DSS error count warning" "1013923" dss "warning"
            "$B > 100 && $B <= 200"
          )
          (rule "dd-4876245-critical" "[DEV] Potential email spam on channel invites" "4876245" invites
            "critical"
            "$B > 10"
          )
          (rule "dd-4876245-warning" "[DEV] Channel invite count warning" "4876245" invites "warning"
            "$B > 5 && $B <= 10"
          )
        ];
      }
    ];
  };
}
