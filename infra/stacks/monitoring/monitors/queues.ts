// Prod SQS queues: dead letters, backlog age and backlog growth.
//
// The two queue-age monitors also exist in Grafana
// (infra/stacks/observability/nixos/prod-alerts.nix); change both together.
// Grafana pages on-call for the work queues, so they only notify here.
import * as datadog from '@pulumi/datadog';
import { graphGroup, prodMonitor, thresholdGraph } from '../prod-monitor';

// One graph per monitor below, titled like it, with its thresholds.
const dashboard = new datadog.Dashboard('queue-alerts', {
  title: 'Queue alerts',
  description:
    'Every prod SQS monitor against its thresholds. Declared in infra/stacks/monitoring/monitors/queues.ts; see docs/runbooks/queues.md.',
  layoutType: 'ordered',
  widgets: [
    graphGroup('Dead letters', [
      thresholdGraph({
        // Thirty-minute sums, as the monitor evaluates them.
        title: 'Messages landing in a prod dead-letter queue',
        query:
          'sum:aws.sqs.number_of_messages_sent{queuename:*-dlq-prod} by {queuename}.as_count().rollup(sum, 1800)',
        critical: '50',
        warning: '0',
      }),
    ]),
    graphGroup('Backlog', [
      thresholdGraph({
        title: 'Email backfill queue falling behind',
        query:
          'max:aws.sqs.approximate_age_of_oldest_message{queuename:email-service-backfill-queue-prod}',
        critical: '10800',
        warning: '3600',
      }),
      thresholdGraph({
        title: 'Prod work queue falling behind',
        query:
          'max:aws.sqs.approximate_age_of_oldest_message{queuename:email-service-refresh-queue-prod OR queuename:convert-service-queue-prod OR queuename:ai-projection-queue-prod OR queuename:email-service-gmail-webhook-queue-prod OR queuename:notification-ingress-queue-prod} by {queuename}',
        critical: '7200',
        warning: '1800',
      }),
      thresholdGraph({
        title: 'Email backfill backlog growing abnormally',
        query:
          "anomalies(max:aws.sqs.approximate_number_of_messages_visible{queuename:email-service-backfill-queue-prod}, 'agile', 3)",
      }),
    ]),
  ],
});

// Datadog only: CloudWatch dimensions can't be filtered by name pattern.
prodMonitor('sqs-dlq-inflow', {
  title: 'Messages landing in a prod dead-letter queue',
  service: 'sqs',
  query:
    'sum(last_30m):sum:aws.sqs.number_of_messages_sent{queuename:*-dlq-prod} by {queuename}.as_count() > 50',
  monitorThresholds: { critical: '50', warning: '0' },
  pages: false,
  description:
    '{{value}} messages moved to {{queuename.name}} in 30 minutes. Most DLQs hold old messages permanently, so this alerts on new arrivals only.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/queues.md#dead-letters',
});

prodMonitor('sqs-email-backfill-age', {
  title: 'Email backfill queue falling behind',
  service: 'email-service',
  query:
    'avg(last_15m):max:aws.sqs.approximate_age_of_oldest_message{queuename:email-service-backfill-queue-prod} > 10800',
  monitorThresholds: { critical: '10800', warning: '3600' },
  pages: false,
  description:
    'The oldest message in email-service-backfill-queue-prod is {{value}} seconds old. Normal peaks are about 50 minutes; new users wait this long for their mailbox to fill.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/queues.md#backlog',
});

prodMonitor('sqs-work-queue-age', {
  title: 'Prod work queue falling behind',
  service: 'sqs',
  query:
    'avg(last_15m):max:aws.sqs.approximate_age_of_oldest_message{queuename:email-service-refresh-queue-prod OR queuename:convert-service-queue-prod OR queuename:ai-projection-queue-prod OR queuename:email-service-gmail-webhook-queue-prod OR queuename:notification-ingress-queue-prod} by {queuename} > 7200',
  monitorThresholds: { critical: '7200', warning: '1800' },
  pages: false,
  description:
    'The oldest message in {{queuename.name}} is {{value}} seconds old. These queues normally drain within minutes.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/queues.md#backlog',
});

// Datadog only: Grafana alerting has no anomaly detection.
prodMonitor('sqs-email-backfill-backlog-anomaly', {
  title: 'Email backfill backlog growing abnormally',
  service: 'email-service',
  query:
    "avg(last_4h):anomalies(max:aws.sqs.approximate_number_of_messages_visible{queuename:email-service-backfill-queue-prod}, 'agile', 3, direction='above', interval=300, alert_window='last_30m', count_default_zero='true') >= 1",
  // An anomaly monitor recovers once no point in its window is outside the band.
  monitorThresholds: { critical: '1', criticalRecovery: '0' },
  monitorThresholdWindows: {
    triggerWindow: 'last_30m',
    recoveryWindow: 'last_15m',
  },
  pages: false,
  description:
    'Visible messages in email-service-backfill-queue-prod are above their usual band. A jump in enqueues loads macrodb through the backfill workers.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/queues.md#backlog',
});
