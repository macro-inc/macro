// Contract with services/firecracker_host and crates/hosted_runtimes.
// Host metrics use macro_entrypoint's OTLP exporter to the local Datadog agent;
// its hostname must equal the fleet's host name. All queries group by that host,
// never computer/user/image IDs. Counters count attempts, including retries.
//
// firecracker_host.ready: 0/1, recorded every <=60s; 0 on health/reconcile failure.
// firecracker_host.operation.failures: counter, operation + error_code enums.
// firecracker_host.golden.builds: counter, outcome=published|failed|secret_refused.
// firecracker_host.reconcile.drift: unresolved objects/errors in the latest pass.
// computer.host.memory.{used_ratio,high_watermark_ratio}: gauges, ratios 0..1,
// tagged host_id + host by the control plane, refreshed each reconcile.
//
// The launch span uses BootSource Display values: golden|hibernation|cold_boot.
// Its duration ends at vCPU resume, excluding launch queue wait, macro-restore,
// enrollment and macrod readiness. A span metric explicitly enables percentiles:
// raw OTLP histograms do not automatically support Datadog p95 queries.
// The macro.* prefix follows existing Datadog-derived span/log metrics;
// firecracker_host.* names are the host's directly emitted OTel instruments.
import * as datadog from '@pulumi/datadog';
import { graphGroup, prodMonitor, thresholdGraph } from '../prod-monitor';

const SERVICE = 'firecracker-host';
const HOST = `env:prod,service:${SERVICE}`;
const RUNBOOK = 'docs/runbooks/firecracker-computers.md';

new datadog.SpansMetric('firecracker-restore-duration', {
  name: 'macro.firecracker.restore.duration',
  filter: {
    query: `service:${SERVICE} resource_name:firecracker_host.launch @source:(golden OR hibernation) status:ok`,
  },
  compute: {
    aggregationType: 'distribution',
    path: '@duration',
    includePercentiles: true,
  },
  groupBies: [
    { path: 'env', tagName: 'env' },
    { path: 'host', tagName: 'host' },
    { path: '@source', tagName: 'source' },
  ],
});

const restore =
  'p95:macro.firecracker.restore.duration{env:prod} by {host,source} / 1000000000';

function operationFailures(
  operation: 'create' | 'hibernate' | 'wake',
  extraFilter = ''
): string {
  const filter = extraFilter ? `,${extraFilter}` : '';
  return `default_zero(sum:firecracker_host.operation.failures{${HOST},operation:${operation}${filter}} by {host}.as_count())`;
}

const createFailures = operationFailures(
  'create',
  '!error_code:golden_not_ready'
);
// Do not let Datadog's default gauge interpolation extend a dead heartbeat.
const ready = `min:firecracker_host.ready{${HOST}} by {host}.fill(null)`;
const goldenFailures = `default_zero(sum:firecracker_host.golden.builds{${HOST},outcome:failed} by {host}.as_count())`;
const goldenRefusals = `default_zero(sum:firecracker_host.golden.builds{${HOST},outcome:secret_refused} by {host}.as_count())`;
const memoryTags = 'env:prod';
const memory = `max:computer.host.memory.used_ratio{${memoryTags}} by {host} / min:computer.host.memory.high_watermark_ratio{${memoryTags}} by {host}`;
const hibernateFailures = operationFailures('hibernate');
const wakeFailures = operationFailures('wake');
const drift = `max:firecracker_host.reconcile.drift{${HOST}} by {host}`;

const dashboard = new datadog.Dashboard('firecracker-computers', {
  title: 'Firecracker computer alerts',
  description:
    'Host restore, lifecycle, golden publication, admission memory and reconciliation. Thresholds are initial rollout guardrails; see docs/runbooks/firecracker-computers.md.',
  layoutType: 'ordered',
  widgets: [
    graphGroup('Lifecycle', [
      thresholdGraph({
        title: 'Firecracker restore p95 slow',
        query: restore,
        critical: '2',
        warning: '1',
      }),
      thresholdGraph({
        title: 'Firecracker create failures',
        query: createFailures,
        critical: '3',
        warning: '1',
      }),
      thresholdGraph({
        title: 'Firecracker hibernate failures',
        query: hibernateFailures,
        critical: '3',
        warning: '1',
      }),
      thresholdGraph({
        title: 'Firecracker wake failures',
        query: wakeFailures,
        critical: '3',
        warning: '1',
      }),
    ]),
    graphGroup('Host health', [
      thresholdGraph({
        title: 'Firecracker host agent unhealthy',
        query: ready,
        critical: '1',
      }),
      thresholdGraph({
        title: 'Firecracker host memory above high watermark',
        query: memory,
        critical: '1',
      }),
      thresholdGraph({
        title: 'Firecracker reconcile drift persists',
        query: drift,
        critical: '0',
      }),
    ]),
    graphGroup('Golden publication', [
      thresholdGraph({
        title: 'Firecracker golden publication failed',
        query: goldenFailures,
        critical: '1',
      }),
      thresholdGraph({
        title: 'Firecracker golden secret scan refused',
        query: goldenRefusals,
        critical: '1',
      }),
    ]),
  ],
});

prodMonitor('firecracker-restore-latency', {
  title: 'Firecracker restore p95 slow',
  service: SERVICE,
  query: `avg(last_10m):${restore} > 2`,
  monitorThresholds: { critical: '2', warning: '1' },
  pages: false,
  description:
    'Successful snapshot restores on {{host.name}} exceed the initial vCPU-resume budget (seconds). Split by source; check queue, storage and guest readiness separately. Sparse traffic or failed restores produce no percentile.',
  dashboard: dashboard.url,
  runbook: `${RUNBOOK}#restore-latency`,
});

prodMonitor('firecracker-create-failures', {
  title: 'Firecracker create failures',
  service: SERVICE,
  query: `sum(last_10m):${createFailures} >= 3`,
  monitorThresholds: { critical: '3', warning: '1' },
  pages: false,
  description:
    'Create attempts on {{host.name}} failed. Retries count separately; golden_not_ready is expected while a golden builds and is excluded. Inspect error_code and the create trace before retrying.',
  dashboard: dashboard.url,
  runbook: `${RUNBOOK}#create-failures`,
});

prodMonitor('firecracker-host-unhealthy', {
  title: 'Firecracker host agent unhealthy',
  service: SERVICE,
  query: `max(last_2m):${ready} < 1`,
  monitorThresholds: { critical: '1' },
  noDataTimeframe: 5,
  pages: true,
  description:
    'Host {{host.name}} reports failed readiness, or its heartbeat has disappeared. A healthy agent records every minute. Missing telemetry may also mean the local collector is down. Verify the host is fenced from purchases before intervention.',
  dashboard: dashboard.url,
  runbook: `${RUNBOOK}#host-agent-down`,
});

prodMonitor('firecracker-golden-failures', {
  title: 'Firecracker golden publication failed',
  service: SERVICE,
  query: `sum(last_10m):${goldenFailures} >= 1`,
  monitorThresholds: { critical: '1' },
  pages: false,
  description:
    'A golden build on {{host.name}} failed before publication. Keep the last accepted image; do not manufacture a ready marker. Inspect the failed build trace and storage checks.',
  dashboard: dashboard.url,
  runbook: `${RUNBOOK}#golden-refused`,
});

prodMonitor('firecracker-golden-secret-refused', {
  title: 'Firecracker golden secret scan refused',
  service: SERVICE,
  query: `sum(last_10m):${goldenRefusals} >= 1`,
  monitorThresholds: { critical: '1' },
  pages: true,
  description:
    'A golden on {{host.name}} was refused because the secret scan detected material that must not be cloned. Keep it unpublished, preserve restricted evidence, and assess credential exposure before rebuilding.',
  dashboard: dashboard.url,
  runbook: `${RUNBOOK}#golden-refused`,
});

prodMonitor('firecracker-host-memory', {
  title: 'Firecracker host memory above high watermark',
  service: SERVICE,
  query: `avg(last_5m):${memory} > 1`,
  monitorThresholds: { critical: '1' },
  pages: true,
  description:
    'Host {{host.name}} has exceeded its configured admission high watermark. This compares live usage with policy, not historical peak RSS. Check freshness, admission refusal and idle hibernation before capacity changes.',
  dashboard: dashboard.url,
  runbook: `${RUNBOOK}#host-out-of-memory`,
});

prodMonitor('firecracker-hibernate-failures', {
  title: 'Firecracker hibernate failures',
  service: SERVICE,
  query: `sum(last_10m):${hibernateFailures} >= 3`,
  monitorThresholds: { critical: '3', warning: '1' },
  pages: false,
  description:
    'Hibernation attempts on {{host.name}} failed; repeated attempts count separately. Check snapshot storage space and the snapshot_create trace. Never discard the running process until the snapshot is durable.',
  dashboard: dashboard.url,
  runbook: `${RUNBOOK}#hibernate-and-wake-failures`,
});

prodMonitor('firecracker-wake-failures', {
  title: 'Firecracker wake failures',
  service: SERVICE,
  query: `sum(last_10m):${wakeFailures} >= 3`,
  monitorThresholds: { critical: '3', warning: '1' },
  pages: false,
  description:
    'Hibernation wakes on {{host.name}} failed. Inspect launch source hibernation, compatibility and guest_restore spans. Keep the saved state and disks until recovery is verified.',
  dashboard: dashboard.url,
  runbook: `${RUNBOOK}#hibernate-and-wake-failures`,
});

prodMonitor('firecracker-reconcile-drift', {
  title: 'Firecracker reconcile drift persists',
  service: SERVICE,
  query: `min(last_5m):${drift} > 0`,
  monitorThresholds: { critical: '0' },
  pages: false,
  description:
    'Host {{host.name}} has unresolved objects or errors across reconciliation passes. Repaired drift alone does not alert. Compare durable records, jailed processes and disks before any cleanup.',
  dashboard: dashboard.url,
  runbook: `${RUNBOOK}#reconcile-drift`,
});
