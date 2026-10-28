-- Run with psql as an authorized database administrator on the DEV writer,
-- connected to macrodb. Roles and grants replicate; do not run on the replica.
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grafana_monitor') THEN
    CREATE ROLE grafana_monitor LOGIN;
  END IF;
  IF EXISTS (
    SELECT FROM pg_roles WHERE rolname = 'grafana_monitor'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'grafana_monitor must be an unprivileged monitoring role';
  END IF;
END $$;
-- RDS administrators cannot change SUPERUSER attributes, even to disable them.
ALTER ROLE grafana_monitor LOGIN CONNECTION LIMIT 5;
GRANT CONNECT ON DATABASE macrodb TO grafana_monitor;
-- Dev revokes PUBLIC schema access; USAGE resolves extension views, not app rows.
GRANT USAGE ON SCHEMA public TO grafana_monitor;
GRANT pg_monitor TO grafana_monitor;
ALTER ROLE grafana_monitor SET default_transaction_read_only = on;
ALTER ROLE grafana_monitor SET statement_timeout = '5s';
ALTER ROLE grafana_monitor SET lock_timeout = '1s';
ALTER ROLE grafana_monitor SET idle_in_transaction_session_timeout = '10s';
-- psql prompts securely; no password is embedded in this file or command history.
\password grafana_monitor
