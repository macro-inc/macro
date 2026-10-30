# Prod alert metrics, shared by the rules in alerting.nix and the panels in
# prod-alerts-dashboard.nix so a rule and its graph cannot drift apart.
#
# Each entry becomes a critical and a warning rule (`<uid>-crit`, `<uid>-warn`)
# and one dashboard panel (`panelId`). Each has a matching Datadog monitor in
# infra/stacks/monitoring/monitors/{macrodb,redis,queues}.ts; keep thresholds
# and windows in sync by hand. Grafana pages for the entries marked `pages`, so
# their Datadog copies only notify.
#
# `firesWhen` is "above" or "below": critical fires past `critical`, warning
# fires between `warning` and `critical`. `window` is in seconds; the rule
# reduces it with `reducer` before comparing.
let
  # The CloudWatch query a rule evaluates and its panel draws.
  cloudwatchQuery =
    {
      namespace,
      metricName,
      dimensions,
      statistic,
    }:
    {
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
in
{
  inherit cloudwatchQuery;
  dashboardUid = "prod-alerts";

  # Dashboard rows, in order. Panel ids are stable: notification links use them.
  rows = [
    {
      id = 101;
      title = "macrodb";
      alerts = [
        {
          panelId = 1;
          uid = "macrodb-primary-freeable-memory";
          title = "macro-db-prod freeable memory low";
          service = "macro-db-prod";
          pages = true;
          metric = rds "FreeableMemory" [ "macro-db-prod" ] "Average";
          unit = "decbytes";
          window = 900;
          reducer = "mean";
          firesWhen = "below";
          warning = 2000000000;
          critical = 1000000000;
          description = "Freeable memory is {{ $values.B }} bytes. Normal is 7-18 GB; it fell to about 0.45 GB during the October overload. Each connection holds about 14 MB of private memory, so check connection count and swap first.";
          runbook = "macrodb.md#memory";
        }
        {
          panelId = 2;
          uid = "macrodb-replica-freeable-memory";
          title = "macro-db-prod-read-replica freeable memory low";
          service = "macro-db-prod";
          pages = true;
          metric = rds "FreeableMemory" [ "macro-db-prod-read-replica" ] "Average";
          unit = "decbytes";
          window = 900;
          reducer = "mean";
          firesWhen = "below";
          warning = 1500000000;
          critical = 750000000;
          description = "Replica freeable memory is {{ $values.B }} bytes. Normal minimum is about 3 GB. The replica serves GraphQL reads, so memory pressure shows up as slow lists.";
          runbook = "macrodb.md#memory";
        }
        {
          panelId = 3;
          uid = "macrodb-swap";
          title = "macro-db-prod swapping";
          service = "macro-db-prod";
          pages = true;
          metric = rds "SwapUsage" bothInstances "Maximum";
          unit = "decbytes";
          window = 900;
          reducer = "mean";
          firesWhen = "above";
          warning = 2000000000;
          critical = 5000000000;
          description = "{{ $labels.DBInstanceIdentifier }} is using {{ $values.B }} bytes of swap. Normal is under 0.6 GB. Swap above 5 GB preceded both October overloads by hours.";
          runbook = "macrodb.md#memory";
        }
        {
          panelId = 4;
          uid = "macrodb-load";
          title = "macro-db-prod database load above vCPU count";
          service = "macro-db-prod";
          pages = true;
          metric = rds "DBLoadRelativeToNumVCPUs" bothInstances "Average";
          unit = "short";
          window = 900;
          reducer = "mean";
          firesWhen = "above";
          warning = 2;
          critical = 4;
          description = "{{ $labels.DBInstanceIdentifier }} has {{ $values.B }}x as many active sessions as vCPUs. Normal is under 1.3; the October overload reached 8. Look at Performance Insights top waits (locks, IO) and the services holding the most connections.";
          runbook = "macrodb.md#load";
        }
        {
          panelId = 5;
          uid = "macrodb-cpu";
          title = "macro-db-prod CPU high";
          service = "macro-db-prod";
          pages = true;
          metric = rds "CPUUtilization" bothInstances "Average";
          unit = "percent";
          window = 900;
          reducer = "mean";
          firesWhen = "above";
          warning = 70;
          critical = 85;
          description = "{{ $labels.DBInstanceIdentifier }} CPU averaged {{ $values.B }}% over 15 minutes. Normal peaks are about 30%.";
          runbook = "macrodb.md#load";
        }
        {
          panelId = 6;
          uid = "macrodb-primary-connections";
          title = "macro-db-prod connections high";
          service = "macro-db-prod";
          pages = true;
          metric = rds "DatabaseConnections" [ "macro-db-prod" ] "Maximum";
          unit = "short";
          window = 600;
          reducer = "mean";
          firesWhen = "above";
          warning = 1700;
          critical = 2200;
          description = "macro-db-prod has {{ $values.B }} connections. Normal 15-minute peaks are about 1,100; max_connections is 3,439. Each connection costs about 14 MB, so this also drains freeable memory.";
          runbook = "macrodb.md#connections";
        }
        {
          panelId = 7;
          uid = "macrodb-replica-connections";
          title = "macro-db-prod-read-replica connections high";
          service = "macro-db-prod";
          metric = rds "DatabaseConnections" [ "macro-db-prod-read-replica" ] "Maximum";
          unit = "short";
          window = 600;
          reducer = "mean";
          firesWhen = "above";
          warning = 550;
          critical = 700;
          description = "The read replica has {{ $values.B }} connections. Normal peaks are about 460.";
          runbook = "macrodb.md#connections";
        }
        {
          panelId = 8;
          uid = "macrodb-replica-lag";
          title = "macro-db-prod-read-replica lagging";
          service = "macro-db-prod";
          pages = true;
          metric = rds "ReplicaLag" [ "macro-db-prod-read-replica" ] "Maximum";
          unit = "s";
          window = 600;
          reducer = "mean";
          firesWhen = "above";
          warning = 60;
          critical = 300;
          description = "The read replica is {{ $values.B }} seconds behind the primary. Normal is under 6 seconds. GraphQL reads use the replica, so users see stale data and missing new items.";
          runbook = "macrodb.md#replica-lag";
        }
        {
          panelId = 9;
          uid = "macrodb-read-latency";
          title = "macro-db-prod disk read latency high";
          service = "macro-db-prod";
          metric = rds "ReadLatency" bothInstances "Average";
          unit = "s";
          window = 900;
          reducer = "mean";
          firesWhen = "above";
          warning = 0.005;
          critical = 0.01;
          description = "{{ $labels.DBInstanceIdentifier }} disk reads take {{ $values.B }} seconds on average. Normal is about 0.6 ms.";
          runbook = "macrodb.md#load";
        }
        {
          panelId = 10;
          uid = "macrodb-free-storage";
          title = "macro-db-prod free storage low";
          service = "macro-db-prod";
          pages = true;
          metric = rds "FreeStorageSpace" bothInstances "Minimum";
          unit = "decbytes";
          window = 3600;
          reducer = "min";
          firesWhen = "below";
          warning = 1500000000000;
          critical = 1000000000000;
          description = "{{ $labels.DBInstanceIdentifier }} has {{ $values.B }} bytes of free storage out of 5.37 TB.";
          runbook = "macrodb.md#storage";
        }
      ];
    }
    {
      id = 102;
      title = "Redis";
      alerts = [
        {
          panelId = 11;
          uid = "redis-memory";
          title = "Redis memory high";
          service = "elasticache";
          pages = true;
          metric = redis "DatabaseMemoryUsagePercentage" "Maximum";
          unit = "percent";
          window = 600;
          reducer = "mean";
          firesWhen = "above";
          warning = 75;
          critical = 90;
          description = "{{ $labels.CacheClusterId }} is using {{ $values.B }}% of maxmemory. Keys without a TTL are never evicted under volatile-lru, so at 100% writes fail.";
          runbook = "redis.md#memory";
        }
        {
          panelId = 12;
          uid = "redis-evictions";
          title = "Redis evicting keys";
          service = "elasticache";
          metric = redis "Evictions" "Sum";
          unit = "short";
          window = 600;
          # Thresholds apply to the ten-minute sum; the panel shows per-minute sums.
          reducer = "sum";
          firesWhen = "above";
          warning = 0;
          critical = 1000;
          description = "{{ $labels.CacheClusterId }} evicted {{ $values.B }} keys in 10 minutes. Prod caches normally evict nothing.";
          runbook = "redis.md#memory";
        }
      ];
    }
    {
      id = 103;
      title = "Queues";
      alerts = [
        {
          panelId = 13;
          uid = "sqs-email-backfill-age";
          title = "Email backfill queue falling behind";
          service = "email-service";
          metric = queueAge [ "email-service-backfill-queue-prod" ];
          unit = "s";
          window = 900;
          reducer = "mean";
          firesWhen = "above";
          warning = 3600;
          critical = 10800;
          description = "The oldest message in email-service-backfill-queue-prod is {{ $values.B }} seconds old. Normal peaks are about 50 minutes; new users wait this long for their mailbox to fill.";
          runbook = "queues.md#backlog";
        }
        {
          panelId = 14;
          uid = "sqs-work-queue-age";
          title = "Prod work queue falling behind";
          service = "sqs";
          pages = true;
          metric = queueAge workQueues;
          unit = "s";
          window = 900;
          reducer = "mean";
          firesWhen = "above";
          warning = 1800;
          critical = 7200;
          description = "The oldest message in {{ $labels.QueueName }} is {{ $values.B }} seconds old. These queues normally drain within minutes.";
          runbook = "queues.md#backlog";
        }
      ];
    }
  ];
}
