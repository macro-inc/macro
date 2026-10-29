import * as datadog from '@pulumi/datadog';
import type * as pulumi from '@pulumi/pulumi';
import { goalertWebhooks } from './goalert';
import { alertMessage, RENOTIFY_MINUTES } from './notify';

/**
 * A prod monitor declared in this stack. The rules with a CloudWatch metric
 * also exist in Grafana (infra/stacks/observability/nixos/prod-alerts.nix); keep
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
    /** `url` of the dashboard graphing this monitor, under a `thresholdGraph` titled `title`. */
    dashboard?: pulumi.Input<string>;
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
        dashboard: args.dashboard,
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

/**
 * A line graph of one prod monitor's metric, titled like the monitor, with
 * its critical and warning thresholds drawn as markers. Anomaly graphs have no
 * markers: the band is the threshold.
 */
export function thresholdGraph(args: {
  title: string;
  query: string;
  critical?: string;
  warning?: string;
}): datadog.types.input.DashboardWidget {
  const markers: datadog.types.input.DashboardWidgetTimeseriesDefinitionMarker[] =
    [];
  if (args.critical !== undefined) {
    markers.push({
      label: 'critical',
      value: `y = ${args.critical}`,
      displayType: 'error dashed',
    });
  }
  if (args.warning !== undefined) {
    markers.push({
      label: 'warning',
      value: `y = ${args.warning}`,
      displayType: 'warning dashed',
    });
  }
  return {
    timeseriesDefinition: {
      title: args.title,
      requests: [{ q: args.query, displayType: 'line' }],
      markers,
    },
  };
}

/** A titled group of related graphs on a dashboard. */
export function graphGroup(
  title: string,
  widgets: datadog.types.input.DashboardWidget[]
): datadog.types.input.DashboardWidget {
  return { groupDefinition: { title, layoutType: 'ordered', widgets } };
}
