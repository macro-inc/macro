// Counts bounded attempts, never distinct mailboxes. No user or credential dimensions.
// Code only: these resources require a separately authorized deployment.
import * as datadog from '@pulumi/datadog';
import { graphGroup, prodMonitor, thresholdGraph } from '../prod-monitor';

const signals = [
  {
    name: 'imap-host-hint-stalled',
    metric: 'macro.imap.host_hint.stalled',
    filter:
      'resource_name:imap.host_notification.flush @notification.pending_too_long:true',
    title: 'IMAP host hint remains pending',
    service: 'imap-service',
    description:
      'A durable host hint has remained pending for at least five minutes. Provider synchronization continues independently. Inspect the internal callback status and generation-fenced ACK save; never clear the marker or reconnect mailboxes as an automatic remedy.',
  },
  {
    name: 'imap-host-catchup-deferred',
    metric: 'macro.email.imap_catchup.deferred',
    filter: 'resource_name:email.imap.catch_up @catchup.needs_attention:true',
    title: 'IMAP host catch-up needs attention',
    service: 'email-service',
    description:
      'A bounded catch-up page had a row/database failure, or a deferred stream has waited at least five minutes. Inspect the singleton cursor, deferred attempts and age. Locked and failed rows retry without blocking other streams; retain provider retry floors and stored cursors.',
  },
] as const;

for (const signal of signals) {
  new datadog.SpansMetric(signal.metric, {
    name: signal.metric,
    compute: { aggregationType: 'count' },
    filter: { query: signal.filter },
    groupBies: [{ path: 'env', tagName: 'env' }],
  });
}

const dashboard = new datadog.Dashboard('imap-host-catchup', {
  title: 'IMAP host catch-up',
  description:
    'Durable hint and singleton catch-up attempts. Counts may repeat the same pending work; no mailbox dimensions or production capacity claims.',
  layoutType: 'ordered',
  widgets: [
    graphGroup(
      'Host catch-up',
      signals.map((signal) =>
        thresholdGraph({
          title: signal.title,
          query: `sum:${signal.metric}{env:prod}.as_count()`,
          critical: '1',
        })
      )
    ),
  ],
});

for (const signal of signals) {
  prodMonitor(signal.name, {
    title: signal.title,
    service: signal.service,
    query: `sum(last_10m):sum:${signal.metric}{env:prod}.as_count() >= 1`,
    monitorThresholds: { critical: '1' },
    pages: false,
    description: `${signal.description} The ten-minute alert window may outlast recovery.`,
    dashboard: dashboard.url,
    runbook: 'docs/architecture/imap-engine.md#host-catch-up-after-restart',
  });
}
