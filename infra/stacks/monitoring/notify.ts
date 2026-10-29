import * as pulumi from '@pulumi/pulumi';

// Where every monitor in this stack notifies: GoAlert, and nothing else.
//
// GoAlert (infra/stacks/observability) has two services. Notify posts each
// alert to the Macro Alerts channel and re-posts it hourly until someone
// acknowledges it; the paging service also phones the on-call engineer.
// Datadog never posts to the channel itself, so an alert shows up once, from
// GoAlert. The one exception is the GoAlert health check in goalert.ts.
//
// Datadog sends warning and alert notifications again every RENOTIFY_MINUTES
// while a monitor stays in that state. The repeat dedups into the open GoAlert
// alert, and reopens it if someone closed it while the monitor still fires.

// Declared in goalert.ts.
export const GOALERT = '@webhook-goalert';
export const GOALERT_CLOSE = '@webhook-goalert-close';
export const GOALERT_NOTIFY = '@webhook-goalert-notify';
export const GOALERT_NOTIFY_CLOSE = '@webhook-goalert-notify-close';

export const RENOTIFY_MINUTES = 60;

/**
 * The notification handles that end every monitor message. A paging monitor's
 * critical alert opens a page; every other warning, alert and no-data
 * notification opens a Notify alert.
 *
 * Datadog allows one state block per state, never nested, so each state gets
 * its own. A recovery closes on both services because a paging monitor may
 * have warned before it alerted, or recovered from no data; closing an alert
 * GoAlert does not have open does nothing.
 */
export function notify({ pages }: { pages: boolean }): string {
  const critical = pages
    ? `{{#is_alert}}Paging on-call. ${GOALERT}{{/is_alert}}`
    : `{{#is_alert}}${GOALERT_NOTIFY}{{/is_alert}}`;
  const recovery = pages
    ? `${GOALERT_CLOSE} ${GOALERT_NOTIFY_CLOSE}`
    : GOALERT_NOTIFY_CLOSE;
  return `${critical}{{#is_warning}}${GOALERT_NOTIFY}{{/is_warning}}{{#is_no_data}}${GOALERT_NOTIFY}{{/is_no_data}}{{#is_recovery}}${recovery}{{/is_recovery}}`;
}

// Datadog's site: dashboard `url`s are paths under it.
export const DATADOG_SITE = 'https://us5.datadoghq.com';

/**
 * A monitor message: the state and value against its threshold, what it
 * means, where to start, and the notification handles.
 */
export function alertMessage({
  description,
  runbook,
  dashboard,
  pages,
}: {
  description: string;
  runbook: string;
  /** A dashboard's `url`, a path such as `/dashboard/abc-def-ghi/title`. */
  dashboard?: pulumi.Input<string>;
  pages: boolean;
}): pulumi.Output<string> {
  return pulumi.output(dashboard).apply((path) => {
    const links = [
      `Runbook: https://github.com/macro-inc/macro/blob/main/${runbook}`,
    ];
    if (path !== undefined) links.push(`Dashboard: ${DATADOG_SITE}${path}`);
    return `{{#is_alert}}🔴 CRITICAL: {{value}} (threshold {{threshold}}){{/is_alert}}{{#is_warning}}🟠 WARNING: {{value}} (warning threshold {{warn_threshold}}){{/is_warning}}{{#is_recovery}}✅ RECOVERED: {{value}}{{/is_recovery}}

${description}

${links.join('\n')}

${notify({ pages })}`;
  });
}
