# infra/stacks/monitoring/monitors/cache.ts
{ q, ... }:
{
  source = "monitors/cache.ts";
  interval = "1m";
  monitors = [
    {
      monitor = "macro-cache-available-memory-low";
      datadogId = 1062487;
      route = "page";
      name = "[PROD] Macro Cache Available Memory Low";
      environment = "prod";
      service = "macro-cache-prod";
      inputs = [
        {
          id = "memory";
          reducer = "mean";
          query = q.cloudwatchMath {
            # CloudWatch's AVG counts a node's missing minute as 0; Datadog
            # averages the nodes that reported.
            expression = "SUM(SEARCH('{AWS/ElastiCache,CacheClusterId} MetricName=\"DatabaseMemoryUsagePercentage\" (CacheClusterId=\"macro-cache-prod-001\" OR CacheClusterId=\"macro-cache-prod-002\")', 'Average', 60)) / DATAPOINT_COUNT(SEARCH('{AWS/ElastiCache,CacheClusterId} MetricName=\"DatabaseMemoryUsagePercentage\" (CacheClusterId=\"macro-cache-prod-001\" OR CacheClusterId=\"macro-cache-prod-002\")', 'Average', 60))";
          };
        }
      ];
      window = 3600;
      delay = 900;
      comparator = ">";
      critical = 90;
      warning = 80;
      translation = "Datadog's `name:macro-cache-prod*` as the two nodes it matches today, averaged as Datadog's ungrouped `avg:` does, over the nodes that reported each minute (CloudWatch's `AVG` would count a gap as 0): 18.50 in both when compared. A node added later needs adding here.";
      comparison = "Replay, 2026-11-13 05:00 to 11-28 00:00 UTC: fired in neither. Live, 2026-11-27 23:43 to 11-28 00:48 UTC: Grafana's rules errored on every evaluation until their metric math query got a statistic (Grafana refuses a CloudWatch query without one). Since that reached Grafana at 2026-11-28 00:04, state history records no Error or NoData state for them, and neither system has fired.";
    }
  ];
}
