// Monitors generated from the shared rule catalog, infra/alerts/rules.json.
//
// The catalog is the source of truth for each rule's thresholds, window,
// severity and paging; Grafana's mirror is generated from the same file by
// infra/stacks/observability/nixos/alerting.nix. Edit rules there, not here.
// infra/alerts/rules.test.ts checks that each Datadog query agrees with the
// rule's comparison, window and critical threshold.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as datadog from '@pulumi/datadog';
import { goalertWebhooks } from '../goalert';
import { alertMessage, RENOTIFY_MINUTES } from '../notify';

export interface CloudWatchQuery {
  namespace: string;
  metricName: string;
  /** Dimension name to the values to alert on; one alert per value. */
  dimensions: Record<string, string[]>;
  statistic: 'Average' | 'Maximum' | 'Minimum' | 'Sum';
  /** How Grafana reduces the window's datapoints to one value. */
  reducer: 'mean' | 'max' | 'min' | 'sum';
}

export interface AlertRule {
  id: string;
  title: string;
  service: string;
  comparison: 'above' | 'below';
  /** Evaluation window, e.g. `15m`; forecast rules look this far ahead. */
  window: string;
  thresholds: { warning?: number; critical: number };
  /** A critical alert pages on-call through GoAlert. Warnings never page. */
  pages: boolean;
  /** Which side pages while both evaluate the rule; the other only notifies. */
  pager: 'datadog' | 'grafana';
  description: string;
  /** Repository path with a heading anchor, e.g. `docs/runbooks/macrodb.md#memory`. */
  runbook: string;
  datadog: {
    type: 'query alert';
    /** The complete monitor query, threshold included. */
    query: string;
    /** Required by anomaly monitors; must match the query's `alert_window`. */
    thresholdWindows?: { triggerWindow: string; recoveryWindow: string };
  };
  grafana: { cloudwatch: CloudWatchQuery } | { gap: string };
}

export interface AlertCatalog {
  rules: AlertRule[];
}

export const catalog: AlertCatalog = JSON.parse(
  readFileSync(join(__dirname, '../../../alerts/rules.json'), 'utf8')
);

// Datadog has no anomaly function for log monitors, so the error-logs anomaly
// rule reads this log-based metric instead. Counts every prod error log line,
// tagged by service.
new datadog.LogsMetric('macro-logs-errors', {
  name: 'macro.logs.errors',
  compute: { aggregationType: 'count' },
  filter: { query: 'env:prod status:error' },
  groupBies: [{ path: 'service', tagName: 'service' }],
});

for (const rule of catalog.rules) {
  const { warning, critical } = rule.thresholds;
  // Only one side pages a rule; Grafana's copy pages when the catalog names it.
  const pages = rule.pages && rule.pager === 'datadog';
  const anomaly = rule.datadog.query.includes('anomalies(');
  new datadog.Monitor(
    `catalog-${rule.id}`,
    {
      name: `[PROD] ${rule.title}`,
      type: rule.datadog.type,
      query: rule.datadog.query,
      message: alertMessage({
        description: rule.description,
        runbook: rule.runbook,
        pages,
      }),
      tags: ['env:prod', `service:${rule.service}`, `catalog:${rule.id}`],
      priority: pages ? '2' : '3',
      monitorThresholds: {
        critical: String(critical),
        ...(warning === undefined ? {} : { warning: String(warning) }),
        // An anomaly monitor recovers once no point in its window is outside the band.
        ...(anomaly ? { criticalRecovery: '0' } : {}),
      },
      ...(rule.datadog.thresholdWindows
        ? { monitorThresholdWindows: rule.datadog.thresholdWindows }
        : {}),
      renotifyInterval: RENOTIFY_MINUTES,
      requireFullWindow: false,
      onMissingData: 'default',
      includeTags: true,
      notifyAudit: false,
    },
    { dependsOn: pages ? goalertWebhooks : [] }
  );
}
