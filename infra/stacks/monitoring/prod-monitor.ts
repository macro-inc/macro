import * as datadog from '@pulumi/datadog';
import type * as pulumi from '@pulumi/pulumi';
import { goalertWebhooks } from './goalert';
import { alertMessage, RENOTIFY_MINUTES } from './notify';

/**
 * A prod monitor declared in this stack. The rules with a CloudWatch metric
 * also exist in Grafana (infra/stacks/observability/nixos/grafana-provisioning/prod-alerts.nix); keep
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
    /** Defaults to a metric `query alert`. */
    type?: string;
    /** Attach matching event samples. Needed for Database Monitoring attributes. */
    enableLogsSample?: boolean;
    /** Evaluate a group only once it has data for the whole window. */
    requireFullWindow?: boolean;
    /** Overrides for the state-line value text in `alertMessage`. */
    alertDetail?: string;
    warningDetail?: string;
    recoveryDetail?: string;
    /**
     * Heartbeats only: alert when the monitor has had no data for this many
     * minutes. It replaces `onMissingData`, which Datadog treats as a
     * separate missing-data mode, so the two are never sent together.
     */
    noDataTimeframe?: number;
    /**
     * Seconds to wait before evaluating, so the newest rollup bucket is
     * complete: a monitor reads an unfinished bucket as it is.
     */
    evaluationDelay?: number;
  }
): datadog.Monitor {
  return new datadog.Monitor(
    name,
    {
      name: `[PROD] ${args.title}`,
      type: args.type ?? 'query alert',
      query: args.query,
      message: alertMessage({
        description: args.description,
        runbook: args.runbook,
        dashboard: args.dashboard,
        pages: args.pages,
        alertDetail: args.alertDetail,
        warningDetail: args.warningDetail,
        recoveryDetail: args.recoveryDetail,
      }),
      tags: ['env:prod', `service:${args.service}`],
      priority: args.pages ? '2' : '3',
      monitorThresholds: args.monitorThresholds,
      monitorThresholdWindows: args.monitorThresholdWindows,
      renotifyInterval: RENOTIFY_MINUTES,
      requireFullWindow: args.requireFullWindow ?? false,
      includeTags: true,
      notifyAudit: false,
      ...(args.noDataTimeframe === undefined
        ? { onMissingData: 'default' }
        : { notifyNoData: true, noDataTimeframe: args.noDataTimeframe }),
      ...(args.enableLogsSample === undefined
        ? {}
        : { enableLogsSample: args.enableLogsSample }),
      ...(args.evaluationDelay === undefined
        ? {}
        : { evaluationDelay: args.evaluationDelay }),
    },
    // The message mentions the GoAlert webhooks, which must exist first.
    { dependsOn: goalertWebhooks }
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
  /** A fixed window, e.g. `month_to_date`, instead of the dashboard's. */
  liveSpan?: string;
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
      liveSpan: args.liveSpan,
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
