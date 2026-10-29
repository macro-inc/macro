// Per-service error and latency anomalies: each compares a service with its
// own usual band, so it fires on a change rather than a fixed count.
//
// Datadog only: prod traces and logs don't reach Grafana, and Grafana alerting
// has no anomaly detection.
import * as datadog from '@pulumi/datadog';
import { prodMonitor } from '../prod-monitor';

// Datadog has no anomaly function for log monitors, so the error-logs anomaly
// monitor reads this log-based metric instead. Counts every prod error log
// line, tagged by service.
new datadog.LogsMetric('macro-logs-errors', {
  name: 'macro.logs.errors',
  compute: { aggregationType: 'count' },
  filter: { query: 'env:prod status:error' },
  groupBies: [{ path: 'service', tagName: 'service' }],
});

// An anomaly monitor recovers once no point in its window is outside the band.
const ANOMALY_THRESHOLDS = { critical: '1', criticalRecovery: '0' };
const ANOMALY_WINDOWS = {
  triggerWindow: 'last_30m',
  recoveryWindow: 'last_15m',
};

prodMonitor('apm-server-error-anomaly', {
  title: 'HTTP server errors abnormally high',
  service: 'apm',
  query:
    "avg(last_4h):anomalies(sum:trace.http.server.request.errors{env:prod} by {service}.as_count(), 'agile', 3, direction='above', interval=300, alert_window='last_30m', count_default_zero='true') >= 1",
  monitorThresholds: ANOMALY_THRESHOLDS,
  monitorThresholdWindows: ANOMALY_WINDOWS,
  pages: false,
  description:
    '{{service.name}} is returning more HTTP server errors than its usual band. Check the latest deploy of that service first.',
  runbook: 'docs/runbooks/regressions.md#errors',
});

prodMonitor('apm-internal-error-anomaly', {
  title: 'Internal span errors abnormally high',
  service: 'apm',
  query:
    "avg(last_4h):anomalies(sum:trace.Internal.errors{env:prod} by {service}.as_count(), 'agile', 3, direction='above', interval=300, alert_window='last_30m', count_default_zero='true') >= 1",
  monitorThresholds: ANOMALY_THRESHOLDS,
  monitorThresholdWindows: ANOMALY_WINDOWS,
  pages: false,
  description:
    '{{service.name}} is recording more failed internal spans (background jobs, workers, browser operations) than its usual band. Check the latest deploy of that service first.',
  runbook: 'docs/runbooks/regressions.md#errors',
});

prodMonitor('apm-consumer-error-anomaly', {
  title: 'Queue consumer errors abnormally high',
  service: 'apm',
  query:
    "avg(last_4h):anomalies(sum:trace.Consumer.errors{env:prod} by {service}.as_count(), 'agile', 3, direction='above', interval=300, alert_window='last_30m', count_default_zero='true') >= 1",
  monitorThresholds: ANOMALY_THRESHOLDS,
  monitorThresholdWindows: ANOMALY_WINDOWS,
  pages: false,
  description:
    '{{service.name}} is failing more queue and Kafka messages than its usual band.',
  runbook: 'docs/runbooks/regressions.md#errors',
});

prodMonitor('apm-latency-anomaly', {
  title: 'HTTP latency abnormally high',
  service: 'apm',
  query:
    "avg(last_4h):anomalies(p95:trace.http.server.request{env:prod AND (service:cloud-storage-service OR service:authentication-service)} by {service}, 'agile', 3, direction='above', interval=300, alert_window='last_30m', count_default_zero='true') >= 1",
  monitorThresholds: ANOMALY_THRESHOLDS,
  monitorThresholdWindows: ANOMALY_WINDOWS,
  pages: false,
  description: '{{service.name}} p95 HTTP latency is above its usual band.',
  runbook: 'docs/runbooks/regressions.md#latency',
});

prodMonitor('error-logs-anomaly', {
  title: 'Error logs abnormally high',
  service: 'logs',
  query:
    "avg(last_4h):anomalies(sum:macro.logs.errors{*} by {service}.as_count(), 'agile', 3, direction='above', interval=300, alert_window='last_30m', count_default_zero='true') >= 1",
  monitorThresholds: ANOMALY_THRESHOLDS,
  monitorThresholdWindows: ANOMALY_WINDOWS,
  pages: false,
  description:
    '{{service.name}} is logging more errors than its usual band. Check the latest deploy of that service first.',
  runbook: 'docs/runbooks/regressions.md#errors',
});
