// OpenSearch cluster.
//
// Adopted from monitors created by hand in the Datadog UI. Do not edit a
// monitor here and in the UI at the same time — this file wins on deploy.
import { adopted } from '../adopted';

// https://us5.datadoghq.com/monitors/21836655
adopted('opensearch-storage-low', {
  name: '[AWS] Opensearch Storage Decreasing',
  type: 'query alert',
  query:
    'avg(last_1h):avg:aws.es.free_storage_space.minimum{region:us-east-1} by {environment} < 10000',
  message: `{{#is_alert}}
🚨 CRITICAL — Low Free Opensearch Storage

Environment: {{environment}}
Storage utilization: {{value}}%
Critical threshold: {{threshold}}%

Opensearch storage utilization has reached a critical level. Investigate storage growth or increase the allocated storage.

@webhook-macro-alert-hook
{{/is_alert}}

{{#is_warning}}
⚠️ WARNING — Low Free Opensearch Storage

Environment: {{environment}}
Storage utilization: {{value}}%
Warning threshold: {{warn_threshold}}%

Opensearch storage utilization is approaching the critical threshold.

@webhook-macro-alert-hook
{{/is_warning}}

{{#is_recovery}}
✅ RECOVERED — Opensearch Storage Normal

Environment: {{environment}}
Storage utilization: {{value}}%

Opensearch storage utilization has returned to an acceptable level.

@webhook-macro-alert-hook
{{/is_recovery}}

@hutch@macro.com @evan@macro.com`,
  monitorThresholds: {
    critical: '10000',
    warning: '20000',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: true,
  newGroupDelay: 60,
  evaluationDelay: 900,
});
