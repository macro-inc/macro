// Prod SQS queues: dead letters, backlog age and backlog growth. Prod Kafka
// consumer groups: committed-offset lag on every topic they read.
//
// The two queue-age monitors also exist in Grafana
// (infra/stacks/observability/nixos/prod-alerts.nix); change both together.
// Grafana pages on-call for the work queues, so they only notify here.
import * as datadog from '@pulumi/datadog';
import { graphGroup, prodMonitor, thresholdGraph } from '../prod-monitor';

const KAFKA_SCOPE =
  '{cluster_name:prod-macro-event-kafka-cluster,!topic:_amazon_msk_canary}';
const KAFKA_LAG = `max:aws.kafka.sum_offset_lag${KAFKA_SCOPE} by {consumer_group,topic}`;

// One graph per monitor below, titled like it, with its thresholds, and a
// per-partition Kafka graph for hot keys.
const dashboard = new datadog.Dashboard('queue-alerts', {
  title: 'Queue alerts',
  description:
    'Every prod SQS and Kafka consumer lag monitor against its thresholds. Declared in infra/stacks/monitoring/monitors/queues.ts; see docs/runbooks/queues.md.',
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
    graphGroup('Kafka consumer lag', [
      thresholdGraph({
        title: 'Kafka consumer far behind',
        query: KAFKA_LAG,
        critical: '5000000',
        warning: '2000000',
      }),
      thresholdGraph({
        // The lowest lag over the trailing day, as the monitor evaluates it.
        title: 'Kafka consumer has not caught up in a day',
        query: `moving_rollup(${KAFKA_LAG}, 86400, 'min')`,
        critical: '1000',
      }),
      thresholdGraph({
        // Close to the topic's whole lag when one of its six partitions holds
        // the backlog.
        title: 'Kafka lag on the most-behind partition',
        query: `max:aws.kafka.max_offset_lag${KAFKA_SCOPE} by {consumer_group,topic}`,
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

// Datadog only, like the two above: Grafana copies exist for the alerts it
// pages on, and these only notify.
prodMonitor('kafka-consumer-lag-high', {
  title: 'Kafka consumer far behind',
  service: 'kafka',
  query: `avg(last_15m):${KAFKA_LAG} > 5000000`,
  monitorThresholds: { critical: '5000000', warning: '2000000' },
  pages: false,
  description:
    '{{consumer_group.name}} is {{value}} events behind on {{topic.name}}. Normal bursts on the busiest topic, macro.email, peak under 1M and drain within a day. Topics keep events for 7 days; the group never reads events deleted before it reaches them.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/queues.md#kafka-consumer-lag',
});

// Every healthy group drains to near zero within 18 hours, even after a
// burst, so one floor fits every group and topic. A group's oldest unread
// event is no older than the last time it caught up, so the first alert
// leaves about six of the topic's seven retention days.
prodMonitor('kafka-consumer-not-caught-up', {
  title: 'Kafka consumer has not caught up in a day',
  service: 'kafka',
  query: `min(last_1d):${KAFKA_LAG} > 1000`,
  monitorThresholds: { critical: '1000' },
  pages: false,
  description:
    "{{consumer_group.name}}'s lag on {{topic.name}} has not dropped below {{value}} events in 24 hours. Healthy groups drain to near zero within 18 hours. When this first fires, its oldest unread event is about a day old at most: about six days remain before the topic's 7-day retention deletes events the group has not read.",
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/queues.md#kafka-consumer-lag',
});
