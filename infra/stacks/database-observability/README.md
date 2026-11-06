# PostgreSQL monitoring pilot

This stack adds one native NixOS/Alloy collector in a private Virginia subnet,
with no inbound ports or public IP. It monitors the dev writer and replica over
verified PostgreSQL TLS and forwards metrics to Ohio Prometheus and query
details to Ohio Loki.
Datadog, application tasks, RDS parameter groups, and production are unchanged.

The collector covers database health plus query-level statistics, normalized SQL,
and sampled activity/waits. Grafana gets provisioned health and query dashboards,
not Grafana Cloud's Database Observability UI. Execution plans, schema discovery
and alert changes are excluded. The stack remains dev-only; validate production
separately before expanding it.

## Deployment order

1. Build and publish a new **Ohio observability** AMI from
   `infra/stacks/observability`; deploy it first. This adds
   `https://otlp.macro-internal.com/api/v1/write` and
   `/loki/api/v1/push`, exact POST-only endpoints
   protected by HTTP Basic (`metrics`, existing OTLP token) over ALB TLS. It
   exposes no query/administration routes. Existing OTLP bearer access is
   unchanged. The password is hashed at boot and passed privately to nginx.
   Grafana gets **Macro PostgreSQL** at `/d/macro-postgres` and
   **Macro PostgreSQL queries** at `/d/macro-postgres-queries`.
2. As an authorized database administrator, connect **to dev writer / macrodb**
   with TLS and run `psql --file monitoring-role.sql`. Choose a random password
   of at least 32 characters at its secure prompt. The role/grants replicate to
   the reader. The script grants statistics access via `pg_monitor`, not
   application-table SELECT; it sets connection and query timeouts and defaults
   to read-only transactions. It doesn't install extensions or restart RDS.
   Existing privileged roles are rejected; the script does not attempt to alter
   superuser-only attributes that the RDS administrator cannot change.
   Schema `USAGE` permits resolving the public extension views without granting
   SELECT on application tables.
   `pg_monitor` can read activity/query information, so treat this credential as
   sensitive.
   Timeouts and read-only defaults come from the role; the connection URI keeps
   TLS verification and connection timeout settings without libpq `options`.
3. On the same dev writer / macrodb connection, run
   `psql --file query-monitoring.sql`. It checks `pg_stat_statements` is already
   preloaded and query IDs are enabled, installs the standard extension if needed,
   updates its SQL views/functions to the installed engine's default version,
   and raises the monitoring role's connection limit from five to eight. The
   extension and role changes replicate; do not run this on the reader. It does
   not reset query statistics or change RDS settings. If the preload check fails,
   review the existing RDS parameter group and plan a reboot separately; this
   stack never restarts the database. Confirm the extension is visible on both
   endpoints before starting Alloy.
   Review custom extension-view consumers before upgrading: old I/O column names
   and object-specific grants can change. RDS can retain an older extension version
   after an engine upgrade; dev PostgreSQL 18 required version 1.12 for the
   exporter's shared/local I/O columns. The SQL update uses bounded lock/statement
   timeouts and does not reset statistics.
4. Save that password in Doppler `observability/dev` as
   `GRAFANA_POSTGRES_PASSWORD` and an AWS-managed-key Secrets Manager secret in
   Virginia with JSON shape `{"password":"..."}`. Use the existing raw-string
   dev-ingest secret for `ingestSecretArn`. Doppler is the operator source;
   the host retrieves only the two explicit AWS secrets using its instance
   role. There is no automatic Doppler-to-Secrets-Manager synchronization.
   Never put values in Pulumi config, command-line arguments or user data.
5. Build the pinned collector image:
   `nix build ./infra/stacks/observability#database-collector --out-link result-database-collector`.
   Publish with
   `python3 infra/stacks/observability/nixos/publish-image.py result-database-collector macro-observability-images-569036502058-us-east-1 --region us-east-1 --name-prefix macro-database-collector --role macro-observability-vmimport`.
   The image is fixed; EC2 user data carries validated nonsecret settings only.
   AMI registration inherits the imported snapshot's minimum root volume size;
   the collector stack expands it to 12 GiB at launch.
6. Initialize the separate Pulumi project here with a `dev` stack. Configure
   `aws:region=us-east-1`, `amiId`, `subnetId`, `secretArn`, and `ingestSecretArn`.
   The subnet must be private, in the database VPC, with outbound NAT/HTTPS
   access to AWS APIs and Ohio. The AMI must be the reviewed collector image
   owned by our account. The stack discovers dev writer/replica endpoints and
   adds port 5432 rules allowing traffic from the collector security group to
   their existing security groups. These rules cover every resource attached
   to those destination groups; verify their membership during preview.
   Run `pulumi preview --stack dev`, review only additive collector resources,
   then deploy. No database resource belongs to this stack.

The stack deliberately requires a reviewed image and secret references, rather
than a fake AMI, generated admin password or automatic database mutation.
Use AWS-managed encryption for the two secrets; a customer-managed key would
also need narrowly scoped `kms:Decrypt` permission.

## Verification before relying on it

Check SSM connectivity and `database-collector-bootstrap` / `alloy` units. Each
endpoint must report `pg_up=1`, `pg_exporter_last_scrape_error=0`, and scrape
`up=1` with distinct `db_instance` and `db_role` labels. Inspect the dashboard's
transaction, connection, lock and vacuum metrics during representative dev
traffic. Missing metrics are not replaced with reassuring zeros. The freshness
panel measures the latest sample's age within Prometheus's five-minute lookback;
after that it shows no data, not an increasing outage timer. Verify no passwords
or connection-string labels appear in ingested data or logs. SQL text is
deliberately present in Loki, not in Prometheus labels. The exporter runs once
per minute with five-second
SQL timeouts; a failing collector does not imply the database is down.

Exercise a temporary receiver outage in an isolated smoke environment, restore
it and verify remote-write catch-up. Alloy self-metrics expose pending/failed
samples. No alert notifications are enabled in this PR; collection-health
alert routing and independent host/disk alarms are follow-up rollout work.
This pilot must not be the sole database monitor.

## Query investigation and limits

Open **Macro PostgreSQL queries**, choose an instance, then click a query ID in
the query overview. Normalized SQL appears directly beside execution time,
workload share, call count, average duration and rows. Sort any metric column,
filter the SQL column, select a database user, or raise the row limit to 200.
The SQL filter searches the ranked rows currently loaded; use the SQL log panel
and query-ID selector for other collected statements. Summary cards and query
charts respect the selected instance, user and query ID. Identical query IDs
across selected users are aggregated.

The overview joins Prometheus counters to SQL associations observed within five
minutes of the selected period's end. A missing SQL association does not hide an
expensive query's counters. SQL text may be unavailable; use the SQL log panel
to search a wider time range. Statements without interval
execution time do not appear in the ranking. Each row links to the same dashboard
with its query ID and the current user/time filters preserved. The wait chart
counts emitted observations per minute; it does not represent time-weighted
active sessions. The blocking panel shows sampled blocked PIDs and their blockers.

The dashboard connects these counters to sampled sessions, waits and I/O timing.
The health dashboard links to it, and the query dashboard links back to collection
health. Empty panels mean missing data or no observed activity, not a healthy DB.

`pg_stat_statements` metrics and SQL associations are collected once per minute,
limited to 200 statements per endpoint ranked by cumulative execution time, with
the upstream collector's low-cost percentile cutoff. This can omit new or cheap
queries; resetting statistics, evictions and first observations also affect
interval calculations. Database execution time is not CPU time, and aggregate
means are not p95/p99. Block I/O time requires `track_io_timing`; this PR does not
enable it. The extension covers statements executed on each endpoint, so the
writer and replica must be collected separately.

Alloy samples `pg_stat_activity` every 15 seconds, emitting query samples and
wait events as observed queries end or change state. Short queries can be missed.
Sample/wait records use collection time as their Loki timestamp; original timing
fields remain in the body. Old idle sessions can retain query-start times beyond
Loki's acceptance window, so forwarding those timestamps could reject a batch
containing fresh observations.
`disable_query_redaction = false` omits raw SQL from activity samples; SQL text
comes from `pg_stat_statements`. Monitoring/system users and system databases
are excluded. The pipeline drops non-DML SQL associations because utility
statements may retain literals. Normalization is not anonymization: identifiers,
application names, client addresses and occasionally literals can be sensitive.
Treat Grafana/Loki access and their backups accordingly. Do not put personal data
or credentials in SQL comments or identifiers.

Before rollout, confirm both endpoints produce
`pg_stat_statements_calls_total` and `pg_stat_statements_seconds_total`, and Loki
has `job="integrations/postgres-queries"` streams with `op="query_association"`.
Run a harmless representative dev query, locate its normalized SQL and query ID,
then observe a long-running query and wait event. Confirm no raw SQL appears in
`op="query_sample"`, and that `grafana_monitor` cannot SELECT application rows.
An hourly `op="health_status"` stream includes upstream requirements for disabled
features; use the actual statement/activity records to verify enabled collection.
A healthy metrics exporter alone does not prove query details work.

Automatic `EXPLAIN` and schema collection are disabled. The pinned Alloy plan
collector prepares statements and needs application-object permissions beyond
`pg_monitor`; those grants need a separate review. Existing Datadog and
`auto_explain` configuration stay unchanged.

## Storage, rotation and rollback

The encrypted 20 GiB gp3 data volume is retained/protected across host
replacement; stable ownership and volume-ID verification prevent silent
fallback to root storage. Prometheus remote-write WAL is retained up to 24 hours,
not an unlimited queue or a guarantee against a whole Virginia failure. Monitor
volume capacity, measure actual telemetry volume and tune the retention before
production. Metrics delivered to Ohio use its existing Prometheus retention; query logs use
Loki's existing 30-day retention. Loki's disk WAL buffers delivery but has no
configured 24-hour cutoff like Prometheus: a sustained outage can fill the
collector volume. Keep disk monitoring and Datadog in place.

For credential rotation, update the role password and AWS secret, then restart
`database-collector-bootstrap.service` over SSM. Alloy stops with bootstrap and
starts with new private systemd credentials; the WAL remains. A partial failure
leaves collection stopped and retrying. Rotating the shared ingest token also
requires updating its Ohio source and all existing OTLP clients.

Rollback by stopping Alloy or removing this collector stack and its added
security-group rules; the WAL volume remains protected. The role may be removed
by an administrator after its last consumer is gone. Keep Datadog running during
all pilot work. Automatic plans, full Datadog inventory and alert-by-alert migration remain
separate passes.

## Existing PostgreSQL monitoring projects

The dashboard uses Grafana's built-in mixed-source table, joins, filters, logs
and time-series panels; no additional plugin is required. Existing projects
provide useful alternatives, with different collection/storage requirements:

- [pgwatch](https://github.com/cybertec-postgresql/pgwatch/) provides a PostgreSQL
  collector and Grafana dashboard suite. Its dashboards expect pgwatch's metric
  names and data model; importing them alone does not populate Alloy data.
- [Crunchy Data pgMonitor](https://github.com/CrunchyData/pgmonitor) provides
  PostgreSQL health dashboards, metrics and alerting resources using its own
  collection definitions.
- [Percona PMM](https://docs.percona.com/percona-monitoring-and-management/3/install-pmm/install-pmm-client/connect-database/aws.html)
  supports RDS PostgreSQL query analytics using pg_stat_statements. Adopting its
  Query Analytics application requires PMM Server and its collection components;
  it is not a standalone panel for this Grafana instance.
- [Grafana Cloud Database Observability](https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/database-observability/introduction/)
  provides a purpose-built query investigation UI using Alloy. Those Cloud
  dashboards/features do not arrive with the open-source collector alone.

This pilot improves the existing self-hosted setup. It does not claim full
Datadog DBM parity: automatic plans, trace correlation and time-weighted active
session analysis remain separate work. A plan-visualization plugin cannot supply
plans that have not been collected.
