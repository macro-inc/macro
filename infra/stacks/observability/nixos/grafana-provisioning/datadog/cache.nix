# infra/stacks/monitoring/monitors/cache.ts
{ q, ... }:
{
  source = "monitors/cache.ts";
  interval = "5m";
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
            expression = "AVG(SEARCH('{AWS/ElastiCache,CacheClusterId} MetricName=\"DatabaseMemoryUsagePercentage\" (CacheClusterId=\"macro-cache-prod-001\" OR CacheClusterId=\"macro-cache-prod-002\")', 'Average', 60))";
          };
        }
      ];
      window = 3600;
      delay = 900;
      comparator = ">";
      critical = 90;
      warning = 80;
      translation = "Datadog's `name:macro-cache-prod*` as the two nodes it matches today, averaged as Datadog's ungrouped `avg:` does: 18.50 in both when compared. A node added later needs adding here.";
    }
  ];
}
