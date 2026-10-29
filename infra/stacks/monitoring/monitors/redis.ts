// ElastiCache memory for every prod cache, per node.
//
// macro-cache-prod climbed from 60% to 100% over a month before writes failed.
// Memory and evictions also exist in Grafana
// (infra/stacks/observability/nixos/prod-alerts.nix); change both together.
// Grafana pages on-call for memory, so it only notifies here.
import * as datadog from '@pulumi/datadog';
import { graphGroup, prodMonitor, thresholdGraph } from '../prod-monitor';

// One graph per monitor below, titled like it, with its thresholds.
const dashboard = new datadog.Dashboard('redis-alerts', {
  title: 'Redis alerts',
  description:
    'Every prod Redis monitor against its thresholds. Declared in infra/stacks/monitoring/monitors/redis.ts; see docs/runbooks/redis.md.',
  layoutType: 'ordered',
  widgets: [
    graphGroup('Memory', [
      thresholdGraph({
        title: 'Redis memory high',
        query:
          'max:aws.elasticache.database_memory_usage_percentage{cacheclusterid:*prod*} by {cacheclusterid}',
        critical: '90',
        warning: '75',
      }),
      thresholdGraph({
        title: 'Redis memory forecast to fill within three days',
        query:
          "forecast(max:aws.elasticache.database_memory_usage_percentage{cacheclusterid:*prod*} by {cacheclusterid}, 'linear', 1)",
        critical: '95',
      }),
    ]),
    graphGroup('Evictions', [
      thresholdGraph({
        // Ten-minute sums, as the monitor evaluates them.
        title: 'Redis evicting keys',
        query:
          'sum:aws.elasticache.evictions{cacheclusterid:*prod*} by {cacheclusterid}.as_count().rollup(sum, 600)',
        critical: '1000',
        warning: '0',
      }),
    ]),
  ],
});

prodMonitor('redis-memory', {
  title: 'Redis memory high',
  service: 'elasticache',
  query:
    'avg(last_10m):max:aws.elasticache.database_memory_usage_percentage{cacheclusterid:*prod*} by {cacheclusterid} > 90',
  monitorThresholds: { critical: '90', warning: '75' },
  pages: false,
  description:
    '{{cacheclusterid.name}} is using {{value}}% of maxmemory. Keys without a TTL are never evicted under volatile-lru, so at 100% writes fail.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/redis.md#memory',
});

// Datadog only: Grafana alerting has no forecast function.
prodMonitor('redis-memory-forecast', {
  title: 'Redis memory forecast to fill within three days',
  service: 'elasticache',
  query:
    "max(next_3d):forecast(max:aws.elasticache.database_memory_usage_percentage{cacheclusterid:*prod*} by {cacheclusterid}, 'linear', 1, interval='60m', history='1w', model='default') >= 95",
  monitorThresholds: { critical: '95' },
  pages: false,
  description:
    '{{cacheclusterid.name}} memory is growing fast enough to pass 95% within three days. macro-cache-prod climbed from 60% to 100% over a month before writes failed.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/redis.md#memory',
});

prodMonitor('redis-evictions', {
  title: 'Redis evicting keys',
  service: 'elasticache',
  query:
    'sum(last_10m):sum:aws.elasticache.evictions{cacheclusterid:*prod*} by {cacheclusterid}.as_count() > 1000',
  monitorThresholds: { critical: '1000', warning: '0' },
  pages: false,
  description:
    '{{cacheclusterid.name}} evicted {{value}} keys in 10 minutes. Prod caches normally evict nothing.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/redis.md#memory',
});
