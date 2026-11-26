// Every bounded classification span contributes one counter sample. Never
// group by mailbox, key ARN, context or credentials. Code only until deployed.
import * as datadog from '@pulumi/datadog';
import { graphGroup, prodMonitor, thresholdGraph } from '../prod-monitor';

const classification =
  'service:imap-service resource_name:imap.credentials.classification';
for (const [name, filter] of [
  ['macro.imap.credentials.unreadable', '@credentials.unreadable_count:1'],
  ['macro.imap.credentials.fleet_guard', '@credentials.fleet_guard:true'],
]) {
  new datadog.SpansMetric(name, {
    name,
    compute: { aggregationType: 'count' },
    filter: { query: `${classification} ${filter}` },
    groupBies: [{ path: 'env', tagName: 'env' }],
  });
}

const monitors = [
  {
    name: 'imap-credentials-unreadable-spike',
    title: 'IMAP saved credential failures rising',
    metric: 'macro.imap.credentials.unreadable',
    critical: '5',
    description:
      'At least five verified ciphertext-damage classifications occurred in ten minutes. These are attempts, not distinct accounts. Inspect the fleet guard and KMS configuration before requesting reconnects; never replay provider credentials or change keys as an automatic remedy.',
  },
  {
    name: 'imap-credentials-fleet-guard',
    title: 'IMAP saved credential fleet guard active',
    metric: 'macro.imap.credentials.fleet_guard',
    critical: '1',
    description:
      'Automatic reconnect parking was blocked because verified unreadable accounts exceeded five percent of the process-local ten-minute sample, including samples below twenty accounts. Provider work keeps ordinary backoff. Check KMS availability, alias, key and context configuration; do not mass-reconnect mailboxes.',
  },
];

const dashboard = new datadog.Dashboard('imap-credentials', {
  title: 'IMAP saved credential recovery',
  description:
    'Bounded classification counters and the five-percent process-local fleet guard. No mailbox or key dimensions. Metrics begin only after this definition is deployed.',
  layoutType: 'ordered',
  widgets: [
    graphGroup(
      'Saved credentials',
      monitors.map((monitor) =>
        thresholdGraph({
          title: monitor.title,
          query: `sum:${monitor.metric}{env:prod}.as_count()`,
          critical: monitor.critical,
        })
      )
    ),
  ],
});

for (const monitor of monitors) {
  prodMonitor(monitor.name, {
    title: monitor.title,
    service: 'imap-service',
    query: `sum(last_10m):sum:${monitor.metric}{env:prod}.as_count() >= ${monitor.critical}`,
    monitorThresholds: { critical: monitor.critical },
    pages: false,
    description: monitor.description,
    dashboard: dashboard.url,
    runbook: 'docs/architecture/imap-engine.md#saved-credential-recovery',
  });
}
