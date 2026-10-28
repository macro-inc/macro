// Log-based error-rate monitors.
//
// Adopted from monitors created by hand in the Datadog UI. Do not edit a
// monitor here and in the UI at the same time — this file wins on deploy.
import { adopted } from '../adopted';

// DSS logs every expired-JWT rejection at ERROR. These are routine client token
// refreshes and make up about 60% of its prod error lines, so the DSS error
// monitors drop them. Log search wildcards are case-sensitive, so each spelling
// (`JwtExpired`, `jwt is expired`, `jwt expired`) is listed; `?` stands in for
// the space.
const DSS_EXPIRED_JWT_EXCLUSION =
  '-@error:(*JwtExpired* OR *jwt?is?expired* OR *jwt?expired*)';

// https://us5.datadoghq.com/monitors/440085
adopted('macroai-error-logs', {
  name: '[MACROAI] Increase in Error logs',
  type: 'log alert',
  query:
    'logs("service:(macroai-query-service-prod OR macroai-store-service-prod OR macroai-proxy-service-prod) status:error").index("*").rollup("count").last("5m") > 2500',
  message: `@teo@macro.com 
@slack-monitoring`,
  tags: ['macro-ai'],
  monitorThresholds: {
    critical: '2500',
    warning: '1000',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: false,
  newHostDelay: 300,
  renotifyInterval: 0,
  enableLogsSample: true,
  groupbySimpleMonitor: false,
});

// https://us5.datadoghq.com/monitors/440088
adopted('macroapi-error-logs', {
  name: '[MACROAPI] Increase in Error Logs',
  type: 'log alert',
  query:
    'logs("service:macro-gql-service-prod status:error").index("*").rollup("count").last("5m") > 50',
  message: '@slack-monitoring',
  monitorThresholds: {
    critical: '50',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: false,
  newHostDelay: 300,
  enableLogsSample: false,
  groupbySimpleMonitor: false,
});

// https://us5.datadoghq.com/monitors/1013923
adopted('dss-errors-dev', {
  name: '[DEV] Increased number of errors for DSS',
  type: 'log alert',
  query: `logs("service:cloud-storage-service env:dev status:error ${DSS_EXPIRED_JWT_EXCLUSION}").index("*").rollup("count").last("5m") > 200`,
  message: '@slack-monitoring',
  monitorThresholds: {
    critical: '200',
    warning: '100',
  },
  onMissingData: 'default',
  notifyAudit: true,
  includeTags: false,
  newHostDelay: 300,
  enableLogsSample: true,
  groupbySimpleMonitor: false,
});

// https://us5.datadoghq.com/monitors/1062128
// No warning threshold: prod error lines exceed 50 per 5 minutes in roughly
// one window in eight, so a warning would notify Slack all day.
adopted('dss-errors-prod', {
  name: '[PROD] Increased number of errors for DSS',
  type: 'log alert',
  query: `logs("service:cloud-storage-service env:prod status:error ${DSS_EXPIRED_JWT_EXCLUSION}").index("*").rollup("count").last("5m") > 150`,
  message: '@slack-monitoring',
  monitorThresholds: {
    critical: '150',
  },
  onMissingData: 'default',
  notifyAudit: true,
  includeTags: false,
  newHostDelay: 300,
  enableLogsSample: true,
  groupbySimpleMonitor: false,
});

// https://us5.datadoghq.com/monitors/1067730
adopted('error-logs-overall', {
  name: '[PROD] Increase in Error Logs',
  type: 'log alert',
  query: 'formula("query - query1").last("5m") > 25000',
  message: `Increase in overall count of error logs across production services.
Please view datadog to checkout what specific items may be causing the issues.

{{#is_alert}}
@slack-holy-shit-alarms 
{{/is_alert}}
{{#is_alert_recovery}}
@slack-holy-shit-alarms 
{{/is_alert_recovery}}

@slack-monitoring`,
  priority: '1',
  tags: ['prod'],
  monitorThresholds: {
    critical: '25000',
    warning: '10000',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: false,
  newHostDelay: 300,
  enableLogsSample: true,
  groupbySimpleMonitor: false,
  variables: {
    eventQueries: [
      {
        name: 'query',
        dataSource: 'logs',
        computes: [
          {
            aggregation: 'count',
            metric: 'count',
          },
        ],
        search: {
          query:
            '(service:*-prod OR (service:document-processor* @env:prod)) error',
        },
      },
      {
        name: 'query1',
        dataSource: 'logs',
        computes: [
          {
            aggregation: 'count',
          },
        ],
        indexes: ['*'],
        search: {
          query: 'service:macroai-proxy-service-prod error',
        },
      },
    ],
  },
});

// https://us5.datadoghq.com/monitors/1082626
adopted('graphql-redis-connect', {
  name: '[MACROAPI] GraphQL could not connect to Redis',
  type: 'log alert',
  query:
    'logs("service:macro-gql-service-prod status:error \\"Failed to reconnect to Redis cache at URL*\\"").index("*").rollup("count").last("5m") >= 1',
  message: '@slack-monitoring',
  priority: '3',
  tags: ['prod'],
  monitorThresholds: {
    critical: '1',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: false,
  newHostDelay: 300,
  enableLogsSample: true,
  groupbySimpleMonitor: false,
});

// https://us5.datadoghq.com/monitors/1333499
adopted('high-channel-invites', {
  name: 'High Channel Invites',
  type: 'log alert',
  query:
    'logs("service:notification-service-prod @notification_event_type:channel_invite").index("*").rollup("count", "@sender_id").last("1h") > 100',
  message: `@slack-monitoring 
High number of channel invites

Investigate whether 1 user is causing this with this log query

\`service:notification-service-prod @notification_event_type:channel_invite\``,
  monitorThresholds: {
    critical: '100',
    warning: '50',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: false,
  newHostDelay: 300,
  enableLogsSample: false,
  groupbySimpleMonitor: false,
});

// https://us5.datadoghq.com/monitors/4876245
adopted('channel-invite-spam-dev', {
  name: '[Channel Invites] [DEV] Potential Email Spam on Channel Invites',
  type: 'log alert',
  query:
    'logs("service:notification-service-dev message:\\"processing message\\" @notification_event_type:channel_invite").index("*").rollup("count").by("@sender_id").last("1h") > 10',
  message: `A user is generating a high number of channel invites. This could mean they are spamming users with invite emails.

@slack-monitoring

@hutch@macro.com`,
  monitorThresholds: {
    critical: '10',
    warning: '5',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: false,
  newGroupDelay: 0,
  enableLogsSample: false,
  groupbySimpleMonitor: false,
});

// https://us5.datadoghq.com/monitors/4876618
adopted('channel-invite-spam-prod', {
  name: '[Channel Invites] [PROD] Potential Email Spam on Channel Invites',
  type: 'log alert',
  query:
    'logs("service:notification-service-prod message:\\"processing message\\" @notification_event_type:channel_invite").index("*").rollup("count").by("@sender_id").last("1h") > 10',
  message: `A user is generating a high number of channel invites. This could mean they are spamming users with invite emails.

@slack-monitoring

@hutch@macro.com`,
  monitorThresholds: {
    critical: '10',
    warning: '5',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: false,
  newGroupDelay: 0,
  enableLogsSample: false,
  groupbySimpleMonitor: false,
  groupRetentionDuration: '1h',
});

// https://us5.datadoghq.com/monitors/22681005
adopted('graphql-cache-worker-host-disposed', {
  name: 'GraphQL cache worker host was disposed',
  type: 'log alert',
  query:
    'logs("message:\\"cache worker host was disposed\\"").index("*").rollup("count").last("5m") > 0',
  message: `**{{eval "int(value)"}}** "cache worker host was disposed" log events in the last 5 minutes.
Reported by the web app's GraphQL cache (\`apps/web/src/lib/graphql-cache/host/worker-host.ts\`).

@webhook-macro-alert-hook`,
  monitorThresholds: {
    critical: '0',
  },
  onMissingData: 'default',
});
