// Existing log contracts: mcp_client's linked_github and oauth adapters,
// mcp_client's callback parser, and pipedream_mcp's authenticated webhook.
// Match final failures, not the normal HTTP 401 challenge that starts OAuth.
import * as datadog from '@pulumi/datadog';
import { goalertWebhooks } from '../goalert';
import { DATADOG_SITE, notify, RENOTIFY_MINUTES } from '../notify';

const monitors = [
  {
    name: 'oauth-linked-token-lookup-failing',
    title: 'OAuth linked-token lookup failing',
    filter: 'env:prod @target:mcp_client* "failed to read linked GitHub token"',
    window: '15m',
    threshold: 3,
    description: `At least three linked GitHub token lookups failed in fifteen minutes. OAuth may have succeeded while GitHub still appears disconnected: the MCP store suppresses these lookup errors.

Check the authentication-service response and the caller's resolved AUTHENTICATION_SERVICE_SECRET_KEY. A 401 here is an internal service credential failure, not a reason to ask users to reconnect. Normal unlinked or expired user tokens return no token and do not emit this log.`,
  },
  {
    name: 'oauth-connection-flow-failing',
    title: 'OAuth connection flows failing',
    filter:
      'env:prod ((@target:mcp_client* ("exchange_code_for_token failed" OR "MCP OAuth provider rejected authorization")) OR (@target:pipedream_mcp* "Pipedream connect flow failed")) -@error:(*access_denied* OR *user_cancelled* OR *user_canceled*) -@reason:(*access_denied* OR *user_cancelled* OR *user_canceled*)',
    window: '1h',
    threshold: 3,
    description: `At least three native MCP or Pipedream OAuth flows failed in an hour. These are completed failures from the token exchange, provider callback, or authenticated Pipedream webhook; explicit user-denial and cancellation codes are excluded.

Inspect the provider, error/reason, and callback URL in the logs. Check app credentials, allowed redirects, requested scopes, and organization approval. A single user's permissions can also cause repeated failures; this alert is a triage signal, not proof of an app-wide outage.`,
  },
  {
    name: 'oauth-client-credentials-rejected',
    title: 'OAuth app credentials rejected',
    filter:
      'env:prod status:(error OR warn) (@error:(*invalid_client* OR *unauthorized_client* OR *incorrect_client_credentials*) OR @reason:(*invalid_client* OR *unauthorized_client* OR *incorrect_client_credentials*))',
    window: '15m',
    threshold: 1,
    description: `An OAuth provider rejected an application's client credentials or allowed grant. Check the affected service and provider in the logs, then the deployed client ID, resolved client secret, app status, and permitted grant types.

This matches application-level error codes across providers. It deliberately excludes invalid_grant and ordinary HTTP 401 responses, which can be expected for expired user grants or an initial MCP authentication challenge.`,
  },
];

for (const monitor of monitors) {
  new datadog.Monitor(
    monitor.name,
    {
      name: `[PROD] ${monitor.title}`,
      type: 'log alert',
      query: `logs(${JSON.stringify(monitor.filter)}).index("*").rollup("count").last("${monitor.window}") >= ${monitor.threshold}`,
      message: `${monitor.description}

[Failure logs](${DATADOG_SITE}/logs?query=${encodeURIComponent(monitor.filter)})
[Coverage and triage](https://github.com/macro-inc/macro/blob/main/infra/stacks/monitoring/README.md#oauth-connection-coverage)

${notify({ pages: false })}`,
      tags: ['env:prod', 'integration:oauth'],
      priority: '3',
      monitorThresholds: { critical: String(monitor.threshold) },
      renotifyInterval: RENOTIFY_MINUTES,
      requireFullWindow: false,
      onMissingData: 'resolve',
      enableLogsSample: false,
      includeTags: false,
    },
    { dependsOn: goalertWebhooks }
  );
}
