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

  # Prod rules. Each has a matching Datadog monitor in
  # infra/stacks/monitoring/monitors/{macrodb,redis,queues}.ts; keep thresholds
  # and windows in sync by hand. Grafana pages for the rules marked `pages`, so
  # their Datadog copies only notify.
  cloudwatch =
    {
      namespace,
      metricName,
      dimensions,
      statistic,
    }:
    window: [
      {
        refId = "A";
        datasourceUid = "cloudwatch";
        relativeTimeRange = {
          from = window;
          to = 0;
        };
        model = {
          refId = "A";
          id = "a";
          region = "us-east-1";
          inherit
            namespace
            metricName
            dimensions
            statistic
            ;
          period = "60";
          matchExact = true;
          metricQueryType = 0;
          metricEditorMode = 0;
          queryMode = "Metrics";
        };
      }
    ];
  # `window` is in seconds; `condition` compares the reduced value $B.
  prodRule =
    {
      uid,
      title,
      severity,
      service,
      pages ? false,
      metric,
      window,
      reducer,
      condition,
      description,
      runbook,
    }:
    {
      inherit uid;
      title = "[PROD] ${title} (${severity})";
      condition = "C";
      for = "0s";
      # Sparse CloudWatch counters have no datapoints when idle.
      noDataState = "OK";
      execErrState = "Error";
      isPaused = false;
      labels = {
        environment = "prod";
        inherit severity service;
        # Only critical alerts page, through GoAlert.
        pages = lib.boolToString (pages && severity == "critical");
      };
      annotations = {
        summary = title;
        inherit description;
        runbook_url = "https://github.com/macro-inc/macro/blob/main/docs/runbooks/${runbook}";
      };
      data = cloudwatch metric window ++ expressions reducer condition;
    };

  rds = metricName: instances: statistic: {
    namespace = "AWS/RDS";
    inherit metricName statistic;
    dimensions.DBInstanceIdentifier = instances;
  };
  bothInstances = [
    "macro-db-prod"
    "macro-db-prod-read-replica"
  ];
  redisNodes = [
    "macro-cache-prod-001"
    "macro-cache-prod-002"
    "email-service-redis-prod-c862c10"
    "calendar-service-redis-prod-aee80d2"
    "connection-gateway-redis-prod-f9d8cd0"
  ];
  redis = metricName: statistic: {
    namespace = "AWS/ElastiCache";
    inherit metricName statistic;
    dimensions.CacheClusterId = redisNodes;
  };
  queueAge = queues: {
    namespace = "AWS/SQS";
    metricName = "ApproximateAgeOfOldestMessage";
    statistic = "Maximum";
    dimensions.QueueName = queues;
  };
  workQueues = [
    "email-service-refresh-queue-prod"
    "convert-service-queue-prod"
    "ai-projection-queue-prod"
    "email-service-gmail-webhook-queue-prod"
    "notification-ingress-queue-prod"
  ];

  primaryMemory = {
    service = "macro-db-prod";
    pages = true;
    metric = rds "FreeableMemory" [ "macro-db-prod" ] "Average";
    window = 900;
    reducer = "mean";
    description = "Freeable memory is {{ $values.B }} bytes. Normal is 7-18 GB; it fell to about 0.45 GB during the October overload. Each connection holds about 14 MB of private memory, so check connection count and swap first.";
    runbook = "macrodb.md#memory";
  };
  replicaMemory = {
    service = "macro-db-prod";
    pages = true;
    metric = rds "FreeableMemory" [ "macro-db-prod-read-replica" ] "Average";
    window = 900;
    reducer = "mean";
    description = "Replica freeable memory is {{ $values.B }} bytes. Normal minimum is about 3 GB. The replica serves GraphQL reads, so memory pressure shows up as slow lists.";
    runbook = "macrodb.md#memory";
  };
  swap = {
    service = "macro-db-prod";
    pages = true;
    metric = rds "SwapUsage" bothInstances "Maximum";
    window = 900;
    reducer = "mean";
    description = "{{ $labels.DBInstanceIdentifier }} is using {{ $values.B }} bytes of swap. Normal is under 0.6 GB. Swap above 5 GB preceded both October overloads by hours.";
    runbook = "macrodb.md#memory";
  };
  load = {
    service = "macro-db-prod";
    pages = true;
    metric = rds "DBLoadRelativeToNumVCPUs" bothInstances "Average";
    window = 900;
    reducer = "mean";
    description = "{{ $labels.DBInstanceIdentifier }} has {{ $values.B }}x as many active sessions as vCPUs. Normal is under 1.3; the October overload reached 8. Look at Performance Insights top waits (locks, IO) and the services holding the most connections.";
    runbook = "macrodb.md#load";
  };
  cpu = {
    service = "macro-db-prod";
    pages = true;
    metric = rds "CPUUtilization" bothInstances "Average";
    window = 900;
    reducer = "mean";
    description = "{{ $labels.DBInstanceIdentifier }} CPU averaged {{ $values.B }}% over 15 minutes. Normal peaks are about 30%.";
    runbook = "macrodb.md#load";
  };
  primaryConnections = {
    service = "macro-db-prod";
    pages = true;
    metric = rds "DatabaseConnections" [ "macro-db-prod" ] "Maximum";
    window = 600;
    reducer = "mean";
    description = "macro-db-prod has {{ $values.B }} connections. Normal 15-minute peaks are about 1,100; max_connections is 3,439. Each connection costs about 14 MB, so this also drains freeable memory.";
    runbook = "macrodb.md#connections";
  };
  replicaConnections = {
    service = "macro-db-prod";
    metric = rds "DatabaseConnections" [ "macro-db-prod-read-replica" ] "Maximum";
    window = 600;
    reducer = "mean";
    description = "The read replica has {{ $values.B }} connections. Normal peaks are about 460.";
    runbook = "macrodb.md#connections";
  };
  replicaLag = {
    service = "macro-db-prod";
    pages = true;
    metric = rds "ReplicaLag" [ "macro-db-prod-read-replica" ] "Maximum";
    window = 600;
    reducer = "mean";
    description = "The read replica is {{ $values.B }} seconds behind the primary. Normal is under 6 seconds. GraphQL reads use the replica, so users see stale data and missing new items.";
    runbook = "macrodb.md#replica-lag";
  };
  readLatency = {
    service = "macro-db-prod";
    metric = rds "ReadLatency" bothInstances "Average";
    window = 900;
    reducer = "mean";
    description = "{{ $labels.DBInstanceIdentifier }} disk reads take {{ $values.B }} seconds on average. Normal is about 0.6 ms.";
    runbook = "macrodb.md#load";
  };
  freeStorage = {
    service = "macro-db-prod";
    pages = true;
    metric = rds "FreeStorageSpace" bothInstances "Minimum";
    window = 3600;
    reducer = "min";
    description = "{{ $labels.DBInstanceIdentifier }} has {{ $values.B }} bytes of free storage out of 5.37 TB.";
    runbook = "macrodb.md#storage";
  };
  redisMemory = {
    service = "elasticache";
    pages = true;
    metric = redis "DatabaseMemoryUsagePercentage" "Maximum";
    window = 600;
    reducer = "mean";
    description = "{{ $labels.CacheClusterId }} is using {{ $values.B }}% of maxmemory. Keys without a TTL are never evicted under volatile-lru, so at 100% writes fail.";
    runbook = "redis.md#memory";
  };
  redisEvictions = {
    service = "elasticache";
    metric = redis "Evictions" "Sum";
    window = 600;
    reducer = "sum";
    description = "{{ $labels.CacheClusterId }} evicted {{ $values.B }} keys in 10 minutes. Prod caches normally evict nothing.";
    runbook = "redis.md#memory";
  };
  backfillAge = {
    service = "email-service";
    metric = queueAge [ "email-service-backfill-queue-prod" ];
    window = 900;
    reducer = "mean";
    description = "The oldest message in email-service-backfill-queue-prod is {{ $values.B }} seconds old. Normal peaks are about 50 minutes; new users wait this long for their mailbox to fill.";
    runbook = "queues.md#backlog";
  };
  workQueueAge = {
    service = "sqs";
    pages = true;
    metric = queueAge workQueues;
    window = 900;
    reducer = "mean";
    description = "The oldest message in {{ $labels.QueueName }} is {{ $values.B }} seconds old. These queues normally drain within minutes.";
    runbook = "queues.md#backlog";
  };

  # Warning and critical are mutually exclusive bands, as in the dev rules.
  prodRules = map prodRule [
    (
      primaryMemory
      // {
        uid = "macrodb-primary-freeable-memory-crit";
        title = "macro-db-prod freeable memory low";
        severity = "critical";
        condition = "$B < 1000000000";
      }
    )
    (
      primaryMemory
      // {
        uid = "macrodb-primary-freeable-memory-warn";
        title = "macro-db-prod freeable memory low";
        severity = "warning";
        condition = "$B < 2000000000 && $B >= 1000000000";
      }
    )
    (
      replicaMemory
      // {
        uid = "macrodb-replica-freeable-memory-crit";
        title = "macro-db-prod-read-replica freeable memory low";
        severity = "critical";
        condition = "$B < 750000000";
      }
    )
    (
      replicaMemory
      // {
        uid = "macrodb-replica-freeable-memory-warn";
        title = "macro-db-prod-read-replica freeable memory low";
        severity = "warning";
        condition = "$B < 1500000000 && $B >= 750000000";
      }
    )
    (
      swap
      // {
        uid = "macrodb-swap-crit";
        title = "macro-db-prod swapping";
        severity = "critical";
        condition = "$B > 5000000000";
      }
    )
    (
      swap
      // {
        uid = "macrodb-swap-warn";
        title = "macro-db-prod swapping";
        severity = "warning";
        condition = "$B > 2000000000 && $B <= 5000000000";
      }
    )
    (
      load
      // {
        uid = "macrodb-load-crit";
        title = "macro-db-prod database load above vCPU count";
        severity = "critical";
        condition = "$B > 4";
      }
    )
    (
      load
      // {
        uid = "macrodb-load-warn";
        title = "macro-db-prod database load above vCPU count";
        severity = "warning";
        condition = "$B > 2 && $B <= 4";
      }
    )
    (
      cpu
      // {
        uid = "macrodb-cpu-crit";
        title = "macro-db-prod CPU high";
        severity = "critical";
        condition = "$B > 85";
      }
    )
    (
      cpu
      // {
        uid = "macrodb-cpu-warn";
        title = "macro-db-prod CPU high";
        severity = "warning";
        condition = "$B > 70 && $B <= 85";
      }
    )
    (
      primaryConnections
      // {
        uid = "macrodb-primary-connections-crit";
        title = "macro-db-prod connections high";
        severity = "critical";
        condition = "$B > 2200";
      }
    )
    (
      primaryConnections
      // {
        uid = "macrodb-primary-connections-warn";
        title = "macro-db-prod connections high";
        severity = "warning";
        condition = "$B > 1700 && $B <= 2200";
      }
    )
    (
      replicaConnections
      // {
        uid = "macrodb-replica-connections-crit";
        title = "macro-db-prod-read-replica connections high";
        severity = "critical";
        condition = "$B > 700";
      }
    )
    (
      replicaConnections
      // {
        uid = "macrodb-replica-connections-warn";
        title = "macro-db-prod-read-replica connections high";
        severity = "warning";
        condition = "$B > 550 && $B <= 700";
      }
    )
    (
      replicaLag
      // {
        uid = "macrodb-replica-lag-crit";
        title = "macro-db-prod-read-replica lagging";
        severity = "critical";
        condition = "$B > 300";
      }
    )
    (
      replicaLag
      // {
        uid = "macrodb-replica-lag-warn";
        title = "macro-db-prod-read-replica lagging";
        severity = "warning";
        condition = "$B > 60 && $B <= 300";
      }
    )
    (
      readLatency
      // {
        uid = "macrodb-read-latency-crit";
        title = "macro-db-prod disk read latency high";
        severity = "critical";
        condition = "$B > 0.01";
      }
    )
    (
      readLatency
      // {
        uid = "macrodb-read-latency-warn";
        title = "macro-db-prod disk read latency high";
        severity = "warning";
        condition = "$B > 0.005 && $B <= 0.01";
      }
    )
    (
      freeStorage
      // {
        uid = "macrodb-free-storage-crit";
        title = "macro-db-prod free storage low";
        severity = "critical";
        condition = "$B < 1000000000000";
      }
    )
    (
      freeStorage
      // {
        uid = "macrodb-free-storage-warn";
        title = "macro-db-prod free storage low";
        severity = "warning";
        condition = "$B < 1500000000000 && $B >= 1000000000000";
      }
    )
    (
      redisMemory
      // {
        uid = "redis-memory-crit";
        title = "Redis memory high";
        severity = "critical";
        condition = "$B > 90";
      }
    )
    (
      redisMemory
      // {
        uid = "redis-memory-warn";
        title = "Redis memory high";
        severity = "warning";
        condition = "$B > 75 && $B <= 90";
      }
    )
    (
      redisEvictions
      // {
        uid = "redis-evictions-crit";
        title = "Redis evicting keys";
        severity = "critical";
        condition = "$B > 1000";
      }
    )
    (
      redisEvictions
      // {
        uid = "redis-evictions-warn";
        title = "Redis evicting keys";
        severity = "warning";
        condition = "$B > 0 && $B <= 1000";
      }
    )
    (
      backfillAge
      // {
        uid = "sqs-email-backfill-age-crit";
        title = "Email backfill queue falling behind";
        severity = "critical";
        condition = "$B > 10800";
      }
    )
    (
      backfillAge
      // {
        uid = "sqs-email-backfill-age-warn";
        title = "Email backfill queue falling behind";
        severity = "warning";
        condition = "$B > 3600 && $B <= 10800";
      }
    )
    (
      workQueueAge
      // {
        uid = "sqs-work-queue-age-crit";
        title = "Prod work queue falling behind";
        severity = "critical";
        condition = "$B > 7200";
      }
    )
    (
      workQueueAge
      // {
        uid = "sqs-work-queue-age-warn";
        title = "Prod work queue falling behind";
        severity = "warning";
        condition = "$B > 1800 && $B <= 7200";
      }
    )
  ];
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
