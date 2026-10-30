// Datadog → GoAlert, the on-call pager on the Ohio observability host
// (infra/stacks/observability).
//
// Each webhook posts to a GoAlert Generic API integration key: `goalert` and
// `goalert-close` to the paging service, `goalert-notify` and
// `goalert-notify-close` to the Notify service, which posts to the Macro Alerts
// channel without phoning anyone. notify.ts picks between them. GoAlert keeps
// one open alert per `dedup` value: repeat notifications (renotify) update it,
// and `action: close` resolves it. `$ALERT_CYCLE_KEY` stays the same from a
// monitor group's trigger to its recovery.
import * as datadog from '@pulumi/datadog';
import * as pulumi from '@pulumi/pulumi';
import { RENOTIFY_MINUTES } from './notify';

const GOALERT_HOST = 'oncall.macro-internal.com';

const alert = {
  summary: '$EVENT_TITLE',
  details: '$LINK\n\n$TEXT_ONLY_MSG',
  dedup: '$ALERT_CYCLE_KEY',
};

/** An opening and a closing webhook for one GoAlert service's integration key. */
function goalertService(name: string, integrationKey: pulumi.Output<string>) {
  const url = pulumi.interpolate`https://${GOALERT_HOST}/api/v2/generic/incoming?token=${integrationKey}`;
  return [
    new datadog.Webhook(name, {
      name,
      url,
      encodeAs: 'json',
      payload: JSON.stringify(alert),
    }),
    new datadog.Webhook(`${name}-close`, {
      name: `${name}-close`,
      url,
      encodeAs: 'json',
      payload: JSON.stringify({ ...alert, action: 'close' }),
    }),
  ];
}

// The integration keys authenticate the requests; they live in this stack's
// encrypted config: `pulumi config set --secret <name> <key>`.
const config = new pulumi.Config();

/** Every webhook notify() mentions. Monitors depend on all of them. */
export const goalertWebhooks = [
  ...goalertService('goalert', config.requireSecret('goalertIntegrationKey')),
  ...goalertService(
    'goalert-notify',
    config.requireSecret('goalertNotifyIntegrationKey')
  ),
];

// Watches the pager from outside. It is the only monitor that posts to the
// Macro Alerts channel directly, through the webhook integration configured in
// the Datadog UI: if GoAlert is down, an alert routed through it never arrives.
new datadog.SyntheticsTest('goalert-health', {
  name: 'GoAlert health check',
  type: 'api',
  subtype: 'http',
  status: 'live',
  tags: ['env:prod', 'service:goalert'],
  locations: ['aws:us-east-1', 'aws:us-west-2'],
  requestDefinition: { method: 'GET', url: `https://${GOALERT_HOST}/health` },
  assertions: [{ type: 'statusCode', operator: 'is', target: '200' }],
  optionsList: {
    tickEvery: 300,
    minFailureDuration: 300,
    // Both locations must fail, so one probe's network trouble is not a page outage.
    minLocationFailed: 2,
    retry: { count: 1, interval: 30000 },
    monitorName: '[PROD] GoAlert unreachable',
    monitorOptions: { renotifyInterval: RENOTIFY_MINUTES },
  },
  message: `GoAlert at https://${GOALERT_HOST} is not answering its health check, so Datadog and Grafana alerts reach neither the on-call engineer nor the channel. Paging falls back to the observability host's CloudWatch alarms.

Runbook: https://github.com/macro-inc/macro/blob/main/infra/stacks/observability/README.md

@webhook-macro-alert-hook`,
});
