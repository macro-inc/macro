# infra/stacks/monitoring/monitors/macrodb.ts
{ ... }:
{
  source = "monitors/macrodb.ts";
  interval = "1m";
  monitors = [
    {
      monitor = "macrodb-blocked-connections";
      datadogId = 23404623;
      route = "page";
      name = "[PROD] macro-db-prod connections blocked on locks";
      status = "not-ported";
      reason = "Datadog Database Monitoring's blocked connections have no Grafana source yet. The Postgres collector (`nixos/database-collector/`) reads only the dev databases, and its exporter has no series for backends waiting on a lock (`pg_stat_activity_count` has no wait event). Porting needs a collector on macro-db-prod and its replica with a query counting `wait_event_type = 'Lock'` per instance.";
    }
  ];
}
