// MacroDB (macro-db-prod and its read replica) health.
//
// Thresholds come from two weeks of 5-minute data before the October overload.
// Monitors on CloudWatch metrics also exist in Grafana
// (infra/stacks/observability/nixos/prod-alerts.nix); change both together.
// Grafana pages on-call for those through GoAlert, so they only notify here.
import * as datadog from '@pulumi/datadog';
import { graphGroup, prodMonitor, thresholdGraph } from '../prod-monitor';

// One graph per monitor below, titled like it, with its thresholds.
const dashboard = new datadog.Dashboard('macrodb-alerts', {
  title: 'MacroDB alerts',
  description:
    'Every prod MacroDB monitor against its thresholds. Declared in infra/stacks/monitoring/monitors/macrodb.ts; see docs/runbooks/macrodb.md.',
  layoutType: 'ordered',
  widgets: [
    graphGroup('Memory', [
      thresholdGraph({
        title: 'macro-db-prod freeable memory low',
        query:
          'avg:aws.rds.freeable_memory{dbinstanceidentifier:macro-db-prod}',
        critical: '1000000000',
        warning: '2000000000',
      }),
      thresholdGraph({
        title: 'macro-db-prod-read-replica freeable memory low',
        query:
          'avg:aws.rds.freeable_memory{dbinstanceidentifier:macro-db-prod-read-replica}',
        critical: '750000000',
        warning: '1500000000',
      }),
      thresholdGraph({
        title: 'macro-db-prod swapping',
        query:
          'max:aws.rds.swap_usage{dbinstanceidentifier:macro-db-prod*} by {dbinstanceidentifier}',
        critical: '5000000000',
        warning: '2000000000',
      }),
    ]),
    graphGroup('Load', [
      thresholdGraph({
        title: 'macro-db-prod database load above vCPU count',
        query:
          'avg:aws.rds.dbload_relative_to_num_vcpus{dbinstanceidentifier:macro-db-prod*} by {dbinstanceidentifier}',
        critical: '4',
        warning: '2',
      }),
      thresholdGraph({
        title: 'macro-db-prod CPU high',
        query:
          'avg:aws.rds.cpuutilization{dbinstanceidentifier:macro-db-prod*} by {dbinstanceidentifier}',
        critical: '85',
        warning: '70',
      }),
      thresholdGraph({
        title: 'macro-db-prod disk read latency high',
        query:
          'avg:aws.rds.read_latency{dbinstanceidentifier:macro-db-prod*} by {dbinstanceidentifier}',
        critical: '0.01',
        warning: '0.005',
      }),
    ]),
    graphGroup('Connections and replication', [
      thresholdGraph({
        title: 'macro-db-prod connections high',
        query:
          'max:aws.rds.database_connections{dbinstanceidentifier:macro-db-prod}',
        critical: '2200',
        warning: '1700',
      }),
      thresholdGraph({
        title: 'macro-db-prod-read-replica connections high',
        query:
          'max:aws.rds.database_connections{dbinstanceidentifier:macro-db-prod-read-replica}',
        critical: '700',
        warning: '550',
      }),
      thresholdGraph({
        title: 'macro-db-prod-read-replica lagging',
        query:
          'max:aws.rds.replica_lag{dbinstanceidentifier:macro-db-prod-read-replica}',
        critical: '300',
        warning: '60',
      }),
    ]),
    graphGroup('Locks', [
      thresholdGraph({
        title: 'macro-db-prod connections blocked on locks',
        query:
          'max:postgresql.activity.blocked_connections{host:macro-db-prod*} by {host}',
        critical: '50',
        warning: '20',
      }),
      thresholdGraph({
        title: 'macro-db-prod long-running transaction',
        query:
          'max:postgresql.activity.xact_start_age{host:macro-db-prod*} by {host}',
        critical: '1800',
        warning: '600',
      }),
    ]),
    graphGroup('Storage', [
      thresholdGraph({
        title: 'macro-db-prod free storage low',
        query:
          'min:aws.rds.free_storage_space{dbinstanceidentifier:macro-db-prod*} by {dbinstanceidentifier}',
        critical: '1000000000000',
        warning: '1500000000000',
      }),
      thresholdGraph({
        title: 'macro-db-prod free storage forecast to run low within a week',
        query:
          "forecast(min:aws.rds.free_storage_space{dbinstanceidentifier:macro-db-prod*} by {dbinstanceidentifier}, 'linear', 1)",
        critical: '500000000000',
      }),
    ]),
  ],
});

prodMonitor('macrodb-primary-freeable-memory', {
  title: 'macro-db-prod freeable memory low',
  service: 'macro-db-prod',
  query:
    'avg(last_15m):avg:aws.rds.freeable_memory{dbinstanceidentifier:macro-db-prod} < 1000000000',
  monitorThresholds: { critical: '1000000000', warning: '2000000000' },
  pages: false,
  description:
    'Freeable memory is {{value}} bytes. Normal is 7-18 GB; it fell to about 0.45 GB during the October overload. Each connection holds about 14 MB of private memory, so check connection count and swap first.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/macrodb.md#memory',
});

prodMonitor('macrodb-replica-freeable-memory', {
  title: 'macro-db-prod-read-replica freeable memory low',
  service: 'macro-db-prod',
  query:
    'avg(last_15m):avg:aws.rds.freeable_memory{dbinstanceidentifier:macro-db-prod-read-replica} < 750000000',
  monitorThresholds: { critical: '750000000', warning: '1500000000' },
  pages: false,
  description:
    'Replica freeable memory is {{value}} bytes. Normal minimum is about 3 GB. The replica serves GraphQL reads, so memory pressure shows up as slow lists.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/macrodb.md#memory',
});

prodMonitor('macrodb-swap', {
  title: 'macro-db-prod swapping',
  service: 'macro-db-prod',
  query:
    'avg(last_15m):max:aws.rds.swap_usage{dbinstanceidentifier:macro-db-prod*} by {dbinstanceidentifier} > 5000000000',
  monitorThresholds: { critical: '5000000000', warning: '2000000000' },
  pages: false,
  description:
    '{{dbinstanceidentifier.name}} is using {{value}} bytes of swap. Normal is under 0.6 GB. Swap above 5 GB preceded both October overloads by hours.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/macrodb.md#memory',
});

prodMonitor('macrodb-load', {
  title: 'macro-db-prod database load above vCPU count',
  service: 'macro-db-prod',
  query:
    'avg(last_15m):avg:aws.rds.dbload_relative_to_num_vcpus{dbinstanceidentifier:macro-db-prod*} by {dbinstanceidentifier} > 4',
  monitorThresholds: { critical: '4', warning: '2' },
  pages: false,
  description:
    '{{dbinstanceidentifier.name}} has {{value}}x as many active sessions as vCPUs. Normal is under 1.3; the October overload reached 8. Look at Performance Insights top waits (locks, IO) and the services holding the most connections.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/macrodb.md#load',
});

prodMonitor('macrodb-cpu', {
  title: 'macro-db-prod CPU high',
  service: 'macro-db-prod',
  query:
    'avg(last_15m):avg:aws.rds.cpuutilization{dbinstanceidentifier:macro-db-prod*} by {dbinstanceidentifier} > 85',
  monitorThresholds: { critical: '85', warning: '70' },
  pages: false,
  description:
    '{{dbinstanceidentifier.name}} CPU averaged {{value}}% over 15 minutes. Normal peaks are about 30%.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/macrodb.md#load',
});

prodMonitor('macrodb-primary-connections', {
  title: 'macro-db-prod connections high',
  service: 'macro-db-prod',
  query:
    'avg(last_10m):max:aws.rds.database_connections{dbinstanceidentifier:macro-db-prod} > 2200',
  monitorThresholds: { critical: '2200', warning: '1700' },
  pages: false,
  description:
    'macro-db-prod has {{value}} connections. Normal 15-minute peaks are about 1,100; max_connections is 3,439. Each connection costs about 14 MB, so this also drains freeable memory.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/macrodb.md#connections',
});

prodMonitor('macrodb-replica-connections', {
  title: 'macro-db-prod-read-replica connections high',
  service: 'macro-db-prod',
  query:
    'avg(last_10m):max:aws.rds.database_connections{dbinstanceidentifier:macro-db-prod-read-replica} > 700',
  monitorThresholds: { critical: '700', warning: '550' },
  pages: false,
  description:
    'The read replica has {{value}} connections. Normal peaks are about 460.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/macrodb.md#connections',
});

prodMonitor('macrodb-replica-lag', {
  title: 'macro-db-prod-read-replica lagging',
  service: 'macro-db-prod',
  query:
    'avg(last_10m):max:aws.rds.replica_lag{dbinstanceidentifier:macro-db-prod-read-replica} > 300',
  monitorThresholds: { critical: '300', warning: '60' },
  pages: false,
  description:
    'The read replica is {{value}} seconds behind the primary. Normal is under 6 seconds. GraphQL reads use the replica, so users see stale data and missing new items.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/macrodb.md#replica-lag',
});

prodMonitor('macrodb-read-latency', {
  title: 'macro-db-prod disk read latency high',
  service: 'macro-db-prod',
  query:
    'avg(last_15m):avg:aws.rds.read_latency{dbinstanceidentifier:macro-db-prod*} by {dbinstanceidentifier} > 0.01',
  monitorThresholds: { critical: '0.01', warning: '0.005' },
  pages: false,
  description:
    '{{dbinstanceidentifier.name}} disk reads take {{value}} seconds on average. Normal is about 0.6 ms.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/macrodb.md#load',
});

prodMonitor('macrodb-free-storage', {
  title: 'macro-db-prod free storage low',
  service: 'macro-db-prod',
  query:
    'avg(last_1h):min:aws.rds.free_storage_space{dbinstanceidentifier:macro-db-prod*} by {dbinstanceidentifier} < 1000000000000',
  monitorThresholds: { critical: '1000000000000', warning: '1500000000000' },
  pages: false,
  description:
    '{{dbinstanceidentifier.name}} has {{value}} bytes of free storage out of 5.37 TB.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/macrodb.md#storage',
});

// Datadog only: Grafana alerting has no forecast function.
prodMonitor('macrodb-free-storage-forecast', {
  title: 'macro-db-prod free storage forecast to run low within a week',
  service: 'macro-db-prod',
  query:
    "min(next_1w):forecast(min:aws.rds.free_storage_space{dbinstanceidentifier:macro-db-prod*} by {dbinstanceidentifier}, 'linear', 1, interval='60m', history='1w', model='default') <= 500000000000",
  monitorThresholds: { critical: '500000000000' },
  pages: false,
  description:
    'At the current write rate {{dbinstanceidentifier.name}} drops below 500 GB free within a week. Find what started writing; recent growth was 100-200 GB a day.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/macrodb.md#storage',
});

// Datadog only: Database Monitoring metrics; Grafana's Postgres collector runs
// against dev only.
prodMonitor('macrodb-blocked-connections', {
  title: 'macro-db-prod connections blocked on locks',
  service: 'macro-db-prod',
  query:
    'avg(last_10m):max:postgresql.activity.blocked_connections{host:macro-db-prod*} by {host} > 50',
  monitorThresholds: { critical: '50', warning: '20' },
  pages: true,
  description:
    "{{host.name}} has {{value}} connections waiting on locks. Normal is under 7. Advisory and tuple locks dominated the October overload; see Database Monitoring's blocking queries view.",
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/macrodb.md#locks',
});

prodMonitor('macrodb-long-transactions', {
  title: 'macro-db-prod long-running transaction',
  service: 'macro-db-prod',
  query:
    'avg(last_10m):max:postgresql.activity.xact_start_age{host:macro-db-prod*} by {host} > 1800',
  monitorThresholds: { critical: '1800', warning: '600' },
  pages: false,
  description:
    'The oldest open transaction on {{host.name}} is {{value}} seconds old. Long transactions hold locks and stop vacuum.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/macrodb.md#locks',
});
