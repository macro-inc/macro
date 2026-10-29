import * as pulumi from '@pulumi/pulumi';

// Where every monitor in this stack notifies.
//
// All monitors post to the Macro Alerts channel. Paging monitors also open a
// GoAlert alert, which phones the on-call engineer, and close it on recovery.
// Datadog sends warning and alert notifications again every RENOTIFY_MINUTES
// while a monitor stays in that state, so an alert nobody fixed keeps showing up.

// Datadog webhook integration that posts into the Macro Alerts channel. It is
// configured in the Datadog UI, not in this stack.
export const MACRO_ALERTS = '@webhook-macro-alert-hook';
// Declared in goalert.ts.
export const GOALERT = '@webhook-goalert';
export const GOALERT_CLOSE = '@webhook-goalert-close';

export const RENOTIFY_MINUTES = 60;

/** The notification handles that end every monitor message. */
export function notify({ pages }: { pages: boolean }): string {
  if (!pages) return MACRO_ALERTS;
  // A recovery closes the page whether the monitor recovers from alert or from
  // a warning it dropped to first. Closing an alert GoAlert no longer has
  // open does nothing.
  return `{{#is_alert}}Paging on-call. ${GOALERT}{{/is_alert}}{{#is_recovery}}${GOALERT_CLOSE}{{/is_recovery}}
${MACRO_ALERTS}`;
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
