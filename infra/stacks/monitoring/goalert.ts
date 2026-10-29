// Datadog → GoAlert, the on-call pager on the Ohio observability host
// (infra/stacks/observability).
//
// Both webhooks post to a GoAlert Generic API integration key. GoAlert keeps
// one open alert per `dedup` value: repeat notifications (renotify) update it,
// and `action: close` resolves it. `$ALERT_CYCLE_KEY` stays the same from a
// monitor group's trigger to its recovery.
import * as datadog from '@pulumi/datadog';
import * as pulumi from '@pulumi/pulumi';
import { notify, RENOTIFY_MINUTES } from './notify';

const GOALERT_HOST = 'oncall.macro-internal.com';

// The integration key authenticates the request; it lives in this stack's
// encrypted config: `pulumi config set --secret goalertIntegrationKey <key>`.
const integrationKey = new pulumi.Config().requireSecret(
  'goalertIntegrationKey'
);
const url = pulumi.interpolate`https://${GOALERT_HOST}/api/v2/generic/incoming?token=${integrationKey}`;
const alert = {
  summary: '$EVENT_TITLE',
  details: '$LINK\n\n$TEXT_ONLY_MSG',
  dedup: '$ALERT_CYCLE_KEY',
};

export const goalertWebhooks = [
  new datadog.Webhook('goalert', {
    name: 'goalert',
    url,
    encodeAs: 'json',
    payload: JSON.stringify(alert),
  }),
  new datadog.Webhook('goalert-close', {
    name: 'goalert-close',
    url,
    encodeAs: 'json',
    payload: JSON.stringify({ ...alert, action: 'close' }),
  }),
];

// Watches the pager from outside. It notifies the channel only: if GoAlert is
// down, a page through GoAlert would never arrive.
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
  message: `GoAlert at https://${GOALERT_HOST} is not answering its health check, so Datadog and Grafana alerts cannot page anyone. Paging falls back to the observability host's CloudWatch alarms.

Runbook: https://github.com/macro-inc/macro/blob/main/infra/stacks/observability/README.md

${notify({ pages: false })}`,
});
