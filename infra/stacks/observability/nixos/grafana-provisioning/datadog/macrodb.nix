# infra/stacks/monitoring/monitors/macrodb.ts
{ q, ... }:
{
  source = "monitors/macrodb.ts";
  interval = "1m";
  monitors = [
    {
      monitor = "macrodb-blocked-connections";
      datadogId = 23404623;
      route = "page";
      name = "[PROD] macro-db-prod connections blocked on locks";
      environment = "prod";
      service = "macro-db-prod";
      inputs = [
        {
          id = "blocked";
          # No backend waiting on a lock is no series: 0.
          query = q.prometheus ''avg_over_time((sum(pg_stat_activity_count{db_instance="macro-db-prod", wait_event_type="Lock"}) or vector(0))[10m:1m])'';
        }
      ];
      window = 600;
      comparator = ">";
      critical = 50;
      warning = 20;
      translation = "Backends waiting on a lock (`wait_event_type=\"Lock\"`) from the Postgres collector, averaged over 10 minutes, for Datadog DBM's blocked connections. The collector reads only the dev databases today, so this reads 0 until one reads macro-db-prod; on dev the query returns 0.";
    }
  ];
}
