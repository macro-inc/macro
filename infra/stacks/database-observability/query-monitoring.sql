-- Run on DEV writer / macrodb after monitoring-role.sql, before starting Alloy.
-- This never changes RDS parameters, resets statistics, or restarts the database.
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF current_database() <> 'macrodb' THEN
    RAISE EXCEPTION 'Connect to macrodb before enabling query monitoring';
  END IF;
  IF NOT ('pg_stat_statements' = ANY(string_to_array(
      replace(current_setting('shared_preload_libraries'), ' ', ''), ','))) THEN
    RAISE EXCEPTION 'pg_stat_statements must already be preloaded; review the RDS parameter group and restart requirement separately';
  END IF;
  IF current_setting('compute_query_id') = 'off' THEN
    RAISE EXCEPTION 'compute_query_id is off; review the RDS configuration separately';
  END IF;
END $$;
-- RDS engine upgrades can leave older extension views installed. PostgreSQL 17+
-- exporters need the shared/local I/O columns supplied by the current views.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '15s';
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
ALTER EXTENSION pg_stat_statements UPDATE;
COMMIT;
-- Allow bounded concurrent health, statement and activity collection.
ALTER ROLE grafana_monitor CONNECTION LIMIT 8;
-- Confirm statistics visibility without reading application rows.
SET ROLE grafana_monitor;
SELECT count(*) AS visible_statement_groups FROM pg_stat_statements;
SELECT count(*) AS visible_sessions FROM pg_stat_activity;
RESET ROLE;
