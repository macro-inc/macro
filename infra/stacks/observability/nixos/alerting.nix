{ lib, ... }:
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
      # in notifications and the rule view.
      annotations = {
        summary = alert.title;
        inherit (alert) description;
        runbook_url = "https://github.com/macro-inc/macro/blob/main/docs/runbooks/${alert.runbook}";
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
  prodRulePair =
    alert:
    let
      critical = builtins.toJSON alert.critical;
      warning = builtins.toJSON alert.warning;
    in
    if alert.firesWhen == "above" then
      [
        (prodRule alert {
          severity = "critical";
          condition = "$B > ${critical}";
        })
        (prodRule alert {
          severity = "warning";
          condition = "$B > ${warning} && $B <= ${critical}";
        })
      ]
    else
      [
        (prodRule alert {
          severity = "critical";
          condition = "$B < ${critical}";
        })
        (prodRule alert {
          severity = "warning";
          condition = "$B < ${warning} && $B >= ${critical}";
        })
      ];
  prodRules = lib.concatMap (row: lib.concatMap prodRulePair row.alerts) prodAlerts.rows;
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
  services.grafana.provision.alerting = {
    contactPoints.settings = {
      apiVersion = 1;
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
          name = "Macro Alerts";
          receivers = [
            {
              uid = "macro-alerts";
              type = "webhook";
              disableResolveMessage = false;
              # The loopback relay adds the channel token; see goalert.nix.
              settings = {
                url = "http://127.0.0.1:8090/grafana";
                httpMethod = "POST";
                title = ''{{ template "default.title" . }}'';
                message = ''{{ template "default.message" . }}'';
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
              # Loopback, so paging does not depend on the ALB. GoAlert closes the
              # alert when Grafana sends the resolved notification.
              settings = {
                url = "http://127.0.0.1:3030/api/v2/grafana/incoming?token=$GOALERT_GRAFANA_KEY";
                httpMethod = "POST";
              };
            }
          ];
        }
      ];
    };
    policies.settings = {
      apiVersion = 1;
      policies = [
        {
          orgId = 1;
          receiver = "Macro Alerts";
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
            # Paging prod rules; `continue` lets the next routes still post them
            # to Macro Alerts.
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
              continue = true;
            }
            {
              receiver = "Macro Alerts";
              object_matchers = [
                [
                  "severity"
                  "="
                  "critical"
                ]
              ];
              repeat_interval = "1h";
            }
            { receiver = "Macro Alerts"; }
          ];
        }
      ];
    };
    rules.settings = {
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
  };
}
