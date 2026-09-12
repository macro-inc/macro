// MacroDB / RDS health.
//
// Adopted from monitors created by hand in the Datadog UI. Do not edit a
// monitor here and in the UI at the same time — this file wins on deploy.
import { adopted } from '../adopted';

// https://us5.datadoghq.com/monitors/1062630
adopted('rds-high-cpu', {
  name: '[PROD] RDS High CPU Utilization',
  type: 'query alert',
  query:
    'avg(last_1h):sum:aws.rds.cpuutilization{name:*-prod} by {name}.weighted() >= 95',
  message: `@hutch@macro.com 
@evan@macro.com 
@teo@macro.com
@webhook-macro-alert-hook

RDS DB {{name.name}} is experiencing high CPU utilization.`,
  monitorThresholds: {
    critical: '95',
    warning: '80',
  },
  onMissingData: 'show_no_data',
  notifyAudit: false,
  includeTags: true,
  newGroupDelay: 0,
  evaluationDelay: 900,
  renotifyInterval: 0,
  requireFullWindow: false,
});

// https://us5.datadoghq.com/monitors/1062636
adopted('macrodb-low-burst-balance', {
  name: '[PROD] MacroDB Low Burst Balance',
  type: 'query alert',
  query: 'avg(last_1h):avg:aws.rds.burst_balance{name:macro-db-prod} <= 10',
  message: '@slack-monitoring',
  monitorThresholds: {
    critical: '10',
    warning: '25',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: false,
  newHostDelay: 300,
  evaluationDelay: 900,
});

// https://us5.datadoghq.com/monitors/1076524
adopted('rds-proxy-connections', {
  name: '[PROD] Excessive concurrent connections in rds proxy',
  type: 'query alert',
  query:
    'avg(last_1h):avg:aws.rds.proxy.database_connections{proxyname:macrodb-proxy-prod} > 500',
  message: `We have excessive concurrent connections in the rds proxy. This can lead to slow database calls and potential outage if other services can not secure a connection

@slack-holy-shit-alarms`,
  monitorThresholds: {
    critical: '500',
  },
  notifyNoData: false,
  notifyAudit: false,
  includeTags: false,
  newHostDelay: 300,
  evaluationDelay: 900,
});

// https://us5.datadoghq.com/monitors/6120132
adopted('rds-storage-utilization', {
  name: '[AWS] RDS Storage utilization is high',
  type: 'query alert',
  query:
    'avg(last_1h):100 - ((avg:aws.rds.free_storage_space{*} by {dbinstanceidentifier,engine} / avg:aws.rds.total_storage_space{*} by {dbinstanceidentifier,engine}) * 100) > 90',
  message: `{{#is_alert}}
🚨 CRITICAL — RDS Storage High

Instance: {{dbinstanceidentifier.name}}
Engine: {{engine.name}}
Storage utilization: {{value}}%
Critical threshold: {{threshold}}%

RDS storage utilization has reached a critical level. Investigate storage growth or increase the allocated storage.

@webhook-macro-alert-hook
{{/is_alert}}

{{#is_warning}}
⚠️ WARNING — RDS Storage High

Instance: {{dbinstanceidentifier.name}}
Engine: {{engine.name}}
Storage utilization: {{value}}%
Warning threshold: {{warn_threshold}}%

RDS storage utilization is approaching the critical threshold.

@webhook-macro-alert-hook
{{/is_warning}}

{{#is_recovery}}
✅ RECOVERED — RDS Storage Normal

Instance: {{dbinstanceidentifier.name}}
Engine: {{engine.name}}
Storage utilization: {{value}}%

RDS storage utilization has returned to an acceptable level.

@webhook-macro-alert-hook
{{/is_recovery}}

@hutch@macro.com @evan@macro.com`,
  tags: ['integration:amazon_rds'],
  monitorThresholds: {
    critical: '90',
    warning: '85',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: true,
  newGroupDelay: 60,
  evaluationDelay: 900,
  renotifyInterval: 0,
  requireFullWindow: false,
});

// https://us5.datadoghq.com/monitors/6120237
adopted('rds-connection-anomaly', {
  name: '[AWS] RDS Anomaly in database connections',
  type: 'query alert',
  query:
    "avg(last_1d):anomalies(avg:aws.rds.database_connections{name:*-prod} by {dbinstanceidentifier}, 'basic', 2, direction='above', interval=300, alert_window='last_1h', count_default_zero='true') >= 0.99",
  message: `The number of connections for RDS database {{dbinstanceidentifier.name}} is outside of the typical range.

@slack-monitoring`,
  tags: ['integration:amazon_rds'],
  monitorThresholds: {
    critical: '0.99',
    criticalRecovery: '0',
  },
  monitorThresholdWindows: {
    recoveryWindow: 'last_15m',
    triggerWindow: 'last_1h',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: true,
  newGroupDelay: 60,
  evaluationDelay: 900,
  renotifyInterval: 0,
  requireFullWindow: false,
});

// https://us5.datadoghq.com/monitors/16918778
adopted('rds-low-freeable-memory', {
  name: 'Low freeable memory for {{database_instance.name}}',
  type: 'query alert',
  query:
    'avg(last_1h):avg:aws.rds.freeable_memory{environment:prod OR database_instance:macro-db-prod.ctkwyjgndnfr.us-east-1.rds.amazonaws.com} by {database_instance} < 2000000000',
  message: `@hutch@macro.com 
@evan@macro.com`,
  monitorThresholds: {
    critical: '2000000000',
    warning: '3000000000',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: true,
  newGroupDelay: 60,
  evaluationDelay: 900,
});

// https://us5.datadoghq.com/monitors/16918920
adopted('rds-high-iops', {
  name: 'Database high iops for {{database_instance.name}}',
  type: 'query alert',
  query:
    'avg(last_1h):avg:aws.rds.write_iops{environment:prod OR database_instance:macro-db-prod.ctkwyjgndnfr.us-east-1.rds.amazonaws.com} by {database_instance}.as_rate() + avg:aws.rds.read_iops{environment:prod OR database_instance:macro-db-prod.ctkwyjgndnfr.us-east-1.rds.amazonaws.com} by {database_instance}.as_rate() > 10000',
  message: `@hutch@macro.com 
@evan@macro.com

@webhook-alarm_webhook_test`,
  monitorThresholds: {
    critical: '10000',
    warning: '9000',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: true,
  newGroupDelay: 60,
  evaluationDelay: 900,
});
