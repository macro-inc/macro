// ElastiCache memory for every prod cache, per node.
//
// macro-cache-prod climbed from 60% to 100% over a month before writes failed.
// Memory and evictions also exist in Grafana
// (infra/stacks/observability/nixos/alerting.nix); change both together.
// Grafana pages on-call for memory, so it only notifies here.
import { prodMonitor } from '../prod-monitor';

prodMonitor('redis-memory', {
  title: 'Redis memory high',
  service: 'elasticache',
  query:
    'avg(last_10m):max:aws.elasticache.database_memory_usage_percentage{cacheclusterid:*prod*} by {cacheclusterid} > 90',
  monitorThresholds: { critical: '90', warning: '75' },
  pages: false,
  description:
    '{{cacheclusterid.name}} is using {{value}}% of maxmemory. Keys without a TTL are never evicted under volatile-lru, so at 100% writes fail.',
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
  runbook: 'docs/runbooks/redis.md#memory',
});
