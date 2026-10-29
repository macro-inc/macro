import * as datadog from '@pulumi/datadog';
import { goalertWebhooks } from './goalert';
import { alertMessage, RENOTIFY_MINUTES } from './notify';

/**
 * A prod monitor declared in this stack. The rules with a CloudWatch metric
 * also exist in Grafana (infra/stacks/observability/nixos/alerting.nix); keep
 * their thresholds and windows in sync there by hand.
 */
export function prodMonitor(
  name: string,
  args: {
    title: string;
    service: string;
    query: string;
    monitorThresholds: datadog.types.input.MonitorMonitorThresholds;
    /** Anomaly monitors only: the query's `alert_window`, and a recovery window. */
    monitorThresholdWindows?: datadog.types.input.MonitorMonitorThresholdWindows;
    /** A critical alert pages on-call through GoAlert. Warnings never page. */
    pages: boolean;
    description: string;
    /** Repository path with a heading anchor, e.g. `docs/runbooks/macrodb.md#memory`. */
    runbook: string;
  }
): datadog.Monitor {
  return new datadog.Monitor(
    name,
    {
      name: `[PROD] ${args.title}`,
      type: 'query alert',
      query: args.query,
      message: alertMessage({
        description: args.description,
        runbook: args.runbook,
        pages: args.pages,
      }),
      tags: ['env:prod', `service:${args.service}`],
      priority: args.pages ? '2' : '3',
      monitorThresholds: args.monitorThresholds,
      monitorThresholdWindows: args.monitorThresholdWindows,
      renotifyInterval: RENOTIFY_MINUTES,
      requireFullWindow: false,
      onMissingData: 'default',
      includeTags: true,
      notifyAudit: false,
    },
    { dependsOn: args.pages ? goalertWebhooks : [] }
  );
}
