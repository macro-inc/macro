// ElastiCache and MemoryDB.
//
// Adopted from monitors created by hand in the Datadog UI. Do not edit a
// monitor here and in the UI at the same time — this file wins on deploy.
import { adopted } from '../adopted';
import { notify } from '../notify';

// https://us5.datadoghq.com/monitors/1062487
adopted('macro-cache-available-memory-low', {
  name: '[PROD] Macro Cache Available Memory Low',
  type: 'query alert',
  query:
    'avg(last_1h):avg:aws.elasticache.database_memory_usage_percentage{name:macro-cache-prod*} > 90',
  message: `macro-cache-prod is using {{value}}% of its memory. Keys without a TTL are never evicted, so at 100% writes fail.

${notify({ pages: true })}`,
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
  // Reports no data: the MemoryDB cluster appears to be gone. Retire separately.
  message: `cloud-storage-cache MemoryDB CPU is at {{value}}%.

${notify({ pages: false })}`,
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
  // Reports no data: the MemoryDB cluster appears to be gone. Retire separately.
  message: `MemoryDB memory usage is at {{value}}%.

${notify({ pages: false })}`,
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
