{ ... }:
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
    data = query ++ [
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
          reducer = "last";
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
  };
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
      ];
    };
    policies.settings = {
      apiVersion = 1;
      policies = [
        {
          orgId = 1;
          receiver = "Macro team email";
          group_by = [
            "grafana_folder"
            "alertname"
            "severity"
          ];
          group_wait = "30s";
          group_interval = "5m";
          repeat_interval = "4h";
        }
      ];
    };
    rules.settings = {
      apiVersion = 1;
      groups = [
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
