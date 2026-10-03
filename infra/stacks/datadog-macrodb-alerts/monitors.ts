/**
 * MacroDB prod alert registry.
 *
 * Each entry becomes one Datadog metric monitor. Deploy only on the prod stack.
 * Notifications target the Macro Alerts channel via @webhook-macro-alert-hook.
 */

export type MonitorSpec = {
  /** Pulumi resource name. Stable across deploys. */
  id: string;
  name: string;
  type: 'query alert';
  query: string;
  message: string;
  tags: string[];
  thresholds: {
    critical: string;
    warning?: string;
    criticalRecovery?: string;
    warningRecovery?: string;
  };
  priority: number;
  requireFullWindow?: boolean;
  evaluationDelay?: number;
  notifyNoData?: boolean;
  noDataTimeframe?: number;
};

/** RDS instance identifiers for MacroDB prod primary and read replica. */
export const MACRODB_PROD_DB_IDS =
  'dbinstanceidentifier:macro-db-prod OR dbinstanceidentifier:macro-db-prod-read-replica';

/**
 * DBM `database_instance` tags (FQDNs) for MacroDB prod primary and read replica.
 */
export const MACRODB_PROD_DATABASE_INSTANCES =
  'database_instance:macro-db-prod.ctkwyjgndnfr.us-east-1.rds.amazonaws.com OR database_instance:macro-db-prod-read-replica.ctkwyjgndnfr.us-east-1.rds.amazonaws.com';

export const MACRODB_PROD_READ_REPLICA_DATABASE_INSTANCE =
  'database_instance:macro-db-prod-read-replica.ctkwyjgndnfr.us-east-1.rds.amazonaws.com';

const ALERTS_CHANNEL = '@webhook-macro-alert-hook';

const COMMON_TAGS = [
  'env:prod',
  'service:macrodb',
  'team:infra',
  'managed:datadog-macrodb-alerts',
];

function alertMessage(body: string): string {
  return `{{#is_alert}}
🚨 ${body}

${ALERTS_CHANNEL}
{{/is_alert}}
{{#is_warning}}
⚠️ ${body}

${ALERTS_CHANNEL}
{{/is_warning}}
{{#is_recovery}}
✅ Recovered: ${body}

${ALERTS_CHANNEL}
{{/is_recovery}}`;
}

/**
 * Prod MacroDB monitors.
 *
 * Thresholds come from 7d baselines (primary CPU avg ~4% / max ~14%, replica
 * max ~36%, lock-wait spikes, blocked_connections mostly 0 with rare spikes,
 * replica lag usually <1s with rare multi-second bumps). Existing UI monitor
 * "[PROD] RDS High CPU Utilization" stays at 95%/1h and is too quiet; these
 * fire earlier into Alerts.
 */
export const MACRODB_PROD_MONITORS: MonitorSpec[] = [
  {
    id: 'macrodb-cpu-high',
    name: '[PROD] MacroDB CPU high',
    type: 'query alert',
    query: `avg(last_10m):avg:aws.rds.cpuutilization{${MACRODB_PROD_DB_IDS}} by {dbinstanceidentifier}.weighted() > 70`,
    message: alertMessage(
      'MacroDB {{dbinstanceidentifier.name}} CPU is {{value}}% (threshold {{threshold}}%). Check DBM activity and top queries.'
    ),
    tags: [...COMMON_TAGS, 'signal:cpu'],
    thresholds: {
      critical: '70',
      warning: '50',
    },
    priority: 2,
    requireFullWindow: true,
    evaluationDelay: 60,
    notifyNoData: false,
  },
  {
    id: 'macrodb-lock-waits-high',
    name: '[PROD] MacroDB lock waits high',
    type: 'query alert',
    query: `avg(last_10m):sum:postgresql.activity.waits{(${MACRODB_PROD_DATABASE_INSTANCES}) AND wait_event_type:Lock} by {database_instance} > 15`,
    message: alertMessage(
      'MacroDB {{database_instance.name}} has {{value}} sessions in Lock waits (threshold {{threshold}}). Check blockers and long transactions in DBM.'
    ),
    tags: [...COMMON_TAGS, 'signal:lock-waits'],
    thresholds: {
      critical: '15',
      warning: '8',
    },
    priority: 1,
    requireFullWindow: false,
    evaluationDelay: 60,
    notifyNoData: false,
  },
  {
    id: 'macrodb-blocked-connections',
    name: '[PROD] MacroDB blocked connections',
    type: 'query alert',
    query: `avg(last_10m):avg:postgresql.activity.blocked_connections{${MACRODB_PROD_DATABASE_INSTANCES}} by {database_instance} > 5`,
    message: alertMessage(
      'MacroDB {{database_instance.name}} has {{value}} blocked connections (threshold {{threshold}}). Lock contention is active.'
    ),
    tags: [...COMMON_TAGS, 'signal:blocked-connections'],
    thresholds: {
      critical: '5',
      warning: '2',
    },
    priority: 1,
    requireFullWindow: false,
    evaluationDelay: 60,
    notifyNoData: false,
  },
  {
    id: 'macrodb-io-waits-high',
    name: '[PROD] MacroDB IO waits high',
    type: 'query alert',
    query: `avg(last_15m):sum:postgresql.activity.waits{(${MACRODB_PROD_DATABASE_INSTANCES}) AND wait_event_type:IO} by {database_instance} > 25`,
    message: alertMessage(
      'MacroDB {{database_instance.name}} has {{value}} sessions in IO waits (threshold {{threshold}}). Check storage IOPS, WAL, and heavy queries.'
    ),
    tags: [...COMMON_TAGS, 'signal:io-waits'],
    thresholds: {
      critical: '25',
      warning: '15',
    },
    priority: 2,
    requireFullWindow: true,
    evaluationDelay: 60,
    notifyNoData: false,
  },
  {
    id: 'macrodb-replication-lag',
    name: '[PROD] MacroDB read replica lag',
    type: 'query alert',
    query: `avg(last_5m):avg:postgresql.replication_delay{${MACRODB_PROD_READ_REPLICA_DATABASE_INSTANCE}} > 60`,
    message: alertMessage(
      'MacroDB read replica lag is {{value}}s (threshold {{threshold}}s). Reads may be stale; check replica CPU/IO and primary WAL pressure.'
    ),
    tags: [...COMMON_TAGS, 'signal:replication-lag'],
    thresholds: {
      critical: '60',
      warning: '15',
    },
    priority: 2,
    requireFullWindow: true,
    evaluationDelay: 60,
    notifyNoData: true,
    noDataTimeframe: 20,
  },
];
