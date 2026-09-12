// ElastiCache and MemoryDB.
//
// Adopted from monitors created by hand in the Datadog UI. Do not edit a
// monitor here and in the UI at the same time — this file wins on deploy.
import { adopted } from '../adopted';

// https://us5.datadoghq.com/monitors/1062487
adopted('macro-cache-available-memory-low', {
  name: '[PROD] Macro Cache Available Memory Low',
  type: 'query alert',
  query:
    'avg(last_1h):avg:aws.elasticache.database_memory_usage_percentage{name:macro-cache-prod*} > 90',
  message: `{{#is_alert}}
@slack-holy-shit-alarms 
{{/is_alert}}
{{#is_alert_recovery}}
@slack-holy-shit-alarms 
{{/is_alert_recovery}}

{{#is_warning_recovery}}
@slack-monitoring 
{{/is_warning_recovery}}
{{#is_warning}}
@slack-monitoring 
{{/is_warning}}`,
  monitorThresholds: {
    critical: '90',
    warning: '80',
  },
  notifyNoData: false,
  notifyAudit: false,
  includeTags: false,
  newHostDelay: 300,
  evaluationDelay: 900,
});

// https://us5.datadoghq.com/monitors/1062685
adopted('cloud-storage-cache-high-cpu', {
  name: '[PROD] Cloud Storage Cache High CPU Utilization',
  type: 'query alert',
  query:
    'avg(last_1h):avg:aws.memorydb.cpuutilization{clustername:cloud-storage-cache-memorydb-prod} > 90',
  message:
    '{{#is_alert}} @slack-holy-shit-alarms {{/is_alert}} {{#is_alert_recovery}} @slack-holy-shit-alarms {{/is_alert_recovery}}',
  monitorThresholds: {
    critical: '90',
    warning: '80',
  },
  notifyNoData: false,
  notifyAudit: false,
  includeTags: false,
  newHostDelay: 300,
  evaluationDelay: 900,
});

// https://us5.datadoghq.com/monitors/1062687
adopted('cloud-storage-cache-low-memory', {
  name: '[PROD] Cloud Storage Cache Low Available Memory',
  type: 'query alert',
  query:
    'avg(last_1h):avg:aws.memorydb.database_memory_usage_percentage{*} > 90',
  message:
    '{{#is_alert}} @slack-holy-shit-alarms {{/is_alert}} {{#is_alert_recovery}} @slack-holy-shit-alarms {{/is_alert_recovery}}',
  monitorThresholds: {
    critical: '90',
    warning: '60',
  },
  notifyNoData: false,
  notifyAudit: false,
  includeTags: false,
  newHostDelay: 300,
  evaluationDelay: 900,
});
