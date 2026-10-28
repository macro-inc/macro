// Independent notification consumers do not commit Kafka offsets. Native MSK
// consumer-group lag is therefore absent; these logs report application backlog.
import * as datadog from '@pulumi/datadog';

const HEALTH = '@telemetry_event:notification_consumer_health';
const CONTEXT = `Notification-retention rollout: pause scheduled cleanup before investigating.
Check consumer health/backlog, notification.delete.publish spans, database latency,
and replica lag. A zero application backlog is not an end-to-end delivery ACK:
Postgres NOTIFY publication and WebSocket delivery can still fail.
@webhook-macro-alert-hook`;

for (const environment of ['dev', 'prod']) {
  const query = `${HEALTH} env:${environment}`;
  const common = {
    tags: [
      `env:${environment}`,
      'service:notification-realtime',
      'rollout:notification-retention',
    ],
    priority: environment === 'prod' ? '2' : '3',
    includeTags: true,
    requireFullWindow: false,
  };
  new datadog.Monitor(`notification-consumer-backlog-${environment}`, {
    ...common,
    name: `[${environment.toUpperCase()}] Notification consumer: application backlog high`,
    type: 'log alert',
    query: `logs("${query} @consumer_health:healthy").index("*").rollup("avg", "@max_offset_backlog").by("@consumer_instance").last("5m") > 1000`,
    message: `One consumer's maximum partition offset backlog averages over {{threshold}} for five minutes. This is not committed-offset lag. The initial threshold is conservative; tune after observing dry-run and canary baselines.\n${CONTEXT}`,
    monitorThresholds: { critical: '1000', warning: '100' },
    // A retired process must not leave its old lag alert firing forever.
    // Stalls in live processes produce explicit health events below.
    onMissingData: 'resolve',
  });
  new datadog.Monitor(`notification-consumer-health-${environment}`, {
    ...common,
    name: `[${environment.toUpperCase()}] Notification consumer: telemetry stale or unavailable`,
    type: 'log alert',
    query: `logs("${query} @consumer_health:(stale OR unavailable OR disconnected)").index("*").rollup("count").by("@consumer_instance").last("5m") > 0`,
    message: `A live consumer has stale statistics, unknown offsets, or no connected brokers after its startup grace period. Do not interpret missing/partial telemetry as zero lag.\n${CONTEXT}`,
    monitorThresholds: { critical: '0' },
    onMissingData: 'resolve',
  });
  new datadog.Monitor(`notification-consumer-heartbeat-${environment}`, {
    ...common,
    name: `[${environment.toUpperCase()}] Notification consumer: no telemetry`,
    type: 'log alert',
    query: `logs("${query}").index("*").rollup("count").last("5m") < 1`,
    message: `No notification-consumer health events arrived for five minutes. Verify DSS consumers are running and log ingestion is healthy. Deploy the consumer instrumentation before enabling this monitor.\n${CONTEXT}`,
    monitorThresholds: { critical: '1' },
    onMissingData: 'default',
  });
  new datadog.Monitor(`notification-delete-publication-${environment}`, {
    ...common,
    name: `[${environment.toUpperCase()}] Notification deletion: realtime publication failed`,
    type: 'log alert',
    query: `logs("env:${environment} \\"failed to publish notification delete realtime update\\"").index("*").rollup("count").last("5m") > 0`,
    message: `A database deletion could not be forwarded to realtime. Deletion has already committed; PostgreSQL NOTIFY is best-effort, not a durable retry queue.\n${CONTEXT}`,
    monitorThresholds: { critical: '0' },
    onMissingData: 'default',
  });
}

// CloudWatch's Lambda Errors stays zero when cleanup succeeds but tracing fails.
// Match the application diagnostic rather than assuming Firehose sets env tags.
new datadog.Monitor('notification-retention-telemetry-export', {
  name: 'Notification retention: trace flush failed',
  type: 'log alert',
  query:
    'logs("\\"notification retention telemetry flush\\"").index("*").rollup("count").last("15m") > 0',
  message: `Cleanup may have succeeded while its traces were lost. Check the Datadog extension, its scoped secret access, and OTLP receiver. Do not retry deletion merely to retry telemetry.\n${CONTEXT}`,
  tags: ['service:notification-retention', 'rollout:notification-retention'],
  priority: '3',
  monitorThresholds: { critical: '0' },
  requireFullWindow: false,
  onMissingData: 'default',
});

export const notificationRetentionDashboard = new datadog.Dashboard(
  'notification-retention',
  {
    title: 'Notification retention rollout',
    description:
      'Application backlog for independent consumers, telemetry health, and retention progress. No committed-offset lag is available. See docs/runbooks/notification-retention.md.',
    layoutType: 'ordered',
    widgets: [
      {
        timeseriesDefinition: {
          title: 'Maximum partition offset backlog, per consumer',
          requests: [
            {
              displayType: 'line',
              logQuery: {
                index: '*',
                searchQuery: `${HEALTH} @consumer_health:healthy`,
                computeQuery: {
                  aggregation: 'max',
                  facet: '@max_offset_backlog',
                },
                groupBies: [
                  { facet: 'env', limit: 2 },
                  { facet: '@consumer_instance', limit: 20 },
                ],
              },
            },
          ],
        },
      },
      {
        timeseriesDefinition: {
          title: 'Consumer health events (missing is not zero lag)',
          requests: [
            {
              displayType: 'bars',
              logQuery: {
                index: '*',
                searchQuery: HEALTH,
                computeQuery: { aggregation: 'count' },
                groupBies: [
                  { facet: 'env', limit: 2 },
                  { facet: '@consumer_health', limit: 5 },
                ],
              },
            },
          ],
        },
      },
      {
        timeseriesDefinition: {
          title: 'Committed parent deletions reported by completed sweeps',
          requests: [
            {
              displayType: 'bars',
              logQuery: {
                index: '*',
                searchQuery: '"notification retention sweep complete"',
                computeQuery: { aggregation: 'sum', facet: '@deleted' },
              },
            },
          ],
        },
      },
      {
        timeseriesDefinition: {
          title: 'MacroDB CPU during rollout',
          requests: [
            {
              q: 'max:aws.rds.cpuutilization{name:macro-db-dev OR name:macro-db-prod} by {name}',
              displayType: 'line',
            },
          ],
        },
      },
    ],
  }
);
