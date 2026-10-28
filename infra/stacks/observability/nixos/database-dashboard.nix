{ lib, pkgs, ... }:
let
  datasource = {
    type = "prometheus";
    uid = "prometheus";
  };
  selector = ''job="integrations/postgres",deployment_environment="dev",db_instance=~"$database"'';
  panel = id: title: expr: unit: {
    inherit id title datasource;
    type = "timeseries";
    gridPos = {
      x = lib.mod (id - 1) 2 * 12;
      y = builtins.div (id - 1) 2 * 8;
      w = 12;
      h = 8;
    };
    targets = [
      {
        refId = "A";
        inherit expr;
        legendFormat = "{{db_instance}} {{datname}} {{mode}}";
      }
    ];
    fieldConfig.defaults = { inherit unit; };
  };
  dashboard = {
    uid = "macro-postgres";
    title = "Macro PostgreSQL";
    schemaVersion = 39;
    version = 1;
    editable = false;
    tags = [
      "macro"
      "postgres"
    ];
    timezone = "browser";
    refresh = "1m";
    time = {
      from = "now-6h";
      to = "now";
    };
    description = "Dev writer and replica collected directly from PostgreSQL. Start with connection health and collection errors. Open the query dashboard for statement costs, normalized SQL and sampled waits. Plans are disabled. Missing data means collection needs attention, not that the database is healthy.";
    templating.list = [
      {
        name = "database";
        label = "Database instance";
        type = "custom";
        query = "macro-db-dev,macro-db-dev-read-replica";
        includeAll = true;
        allValue = "macro-db-dev.*";
        multi = false;
        current = {
          text = "All";
          value = "$__all";
        };
        options = [ ];
      }
    ];
    links = [
      {
        title = "Query costs, SQL and sampled waits";
        type = "link";
        url = "/d/macro-postgres-queries";
      }
      {
        title = "AWS database health";
        type = "link";
        url = "/d/macro-database";
      }
    ];
    panels = [
      (panel 1 "Database connection healthy (1 = yes)" "pg_up{${selector}}" "short")
      (panel 2 "Exporter collection errors (1 = error)" "pg_exporter_last_scrape_error{${selector}}"
        "short"
      )
      (panel 3 "Database connections" ''pg_stat_database_numbackends{${selector},datname="macrodb"}''
        "short"
      )
      (panel 4 "Transactions per second"
        ''sum by (db_instance, datname) (rate(pg_stat_database_xact_commit{${selector},datname="macrodb"}[5m]) + rate(pg_stat_database_xact_rollback{${selector},datname="macrodb"}[5m]))''
        "ops"
      )
      (panel 5 "Deadlocks in five minutes"
        ''increase(pg_stat_database_deadlocks{${selector},datname="macrodb"}[5m])''
        "short"
      )
      (panel 6 "Temporary data written per second"
        ''rate(pg_stat_database_temp_bytes{${selector},datname="macrodb"}[5m])''
        "Bps"
      )
      (panel 7 "Locks by mode"
        ''sum by (db_instance, mode) (pg_locks_count{${selector},datname="macrodb"})''
        "short"
      )
      (panel 8 "Dead tuples (vacuum backlog indicator)"
        ''sum by (db_instance) (pg_stat_user_tables_n_dead_tup{${selector},datname="macrodb"})''
        "short"
      )
      (panel 9 "Database scrape freshness" "time() - timestamp(pg_up{${selector}})" "s")
      (panel 10 "Remote-write pending samples"
        ''prometheus_remote_storage_samples_pending{job="observability/database-collector",deployment_environment="dev"}''
        "short"
      )
      (panel 11 "Scrape target healthy (1 = yes)" "up{${selector}}" "short")
      (panel 12 "Remote-write failed samples per second"
        ''rate(prometheus_remote_storage_samples_failed_total{job="observability/database-collector",deployment_environment="dev"}[5m])''
        "ops"
      )
    ];
  };
in
{
  services.grafana.provision.dashboards.settings.providers = [
    {
      name = "macro-postgres";
      orgId = 1;
      folder = "Macro";
      type = "file";
      disableDeletion = true;
      allowUiUpdates = false;
      options.path = pkgs.linkFarm "macro-postgres-dashboard" [
        {
          name = "postgres.json";
          path = pkgs.writeText "postgres.json" (builtins.toJSON dashboard);
        }
      ];
    }
  ];
}
