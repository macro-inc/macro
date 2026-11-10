// AI provider accounts: suspensions, exhausted credit, and spend against the
// monthly caps Macro set with providers.
//
// A provider that suspends Macro's account fails every request until someone
// fixes billing (Fireworks answered `412 Precondition Failed: Account … is
// suspended` once its $30 monthly limit was reached, and nothing alerted). The
// metrics below are built from telemetry the services emit, so these are their
// contract; renaming one silently empties a metric:
//
// - The `ai provider account unavailable` ERROR log, with `provider`,
//   `http_status` and `reason` (`suspended` | `out_of_credit`), from
//   `genai_telemetry::provider_account` in every Rust service that calls a
//   provider with Macro's key.
// - The `ai.provider_account_unavailable` span with `ai.provider` and
//   `ai.account_unavailable`, from ai-editing-worker
//   (services/ai-editing-worker/src/provider-account.ts): the worker's logs do
//   not reach Datadog, its spans do, unsampled.
// - The `ai usage priced` INFO log, with `provider` (the routing segment of the
//   model id, absent for bare ids) and `cost_usd`, from `ai_usage` for every
//   priced call. Logs are ingested in full; the `ai_usage.record` span carries
//   the same cost but is sampled.
import * as datadog from '@pulumi/datadog';
import { graphGroup, prodMonitor, thresholdGraph } from '../prod-monitor';

const RUNBOOK = 'docs/runbooks/ai-providers.md';

new datadog.LogsMetric('ai-provider-account-unavailable', {
  name: 'macro.ai.provider_account_unavailable',
  compute: { aggregationType: 'count' },
  filter: { query: 'status:error "ai provider account unavailable"' },
  groupBies: [
    { path: 'env', tagName: 'env' },
    { path: 'service', tagName: 'service' },
    { path: '@provider', tagName: 'provider' },
    { path: '@reason', tagName: 'reason' },
  ],
});

new datadog.SpansMetric('ai-editing-provider-account-unavailable', {
  name: 'macro.ai.editing.provider_account_unavailable',
  compute: { aggregationType: 'count' },
  filter: { query: 'resource_name:ai.provider_account_unavailable' },
  groupBies: [
    { path: 'env', tagName: 'env' },
    { path: '@ai.provider', tagName: 'provider' },
    { path: '@ai.account_unavailable', tagName: 'reason' },
  ],
});

new datadog.LogsMetric('ai-usage-cost', {
  name: 'macro.ai.usage.cost_usd',
  compute: { aggregationType: 'distribution', path: '@cost_usd' },
  filter: { query: 'status:info "ai usage priced"' },
  groupBies: [
    { path: 'env', tagName: 'env' },
    { path: '@provider', tagName: 'provider' },
  ],
});

/**
 * Monthly spending caps set in each provider's console, in USD, keyed by the
 * `provider` tag. Only caps written down somewhere are here; a provider
 * without one gets no spend monitor. Change a cap here when it changes in the
 * console.
 *
 * A cap is per provider account, not per environment, so spend is summed
 * across environments: a key shared by dev and prod counts in full.
 */
const MONTHLY_CAPS = [{ provider: 'fireworks', name: 'Fireworks', usd: 30 }];

const QUERIES = {
  accountUnavailable:
    'sum:macro.ai.provider_account_unavailable{env:prod} by {provider,reason}.as_count()',
  editingAccountUnavailable:
    'sum:macro.ai.editing.provider_account_unavailable{env:production} by {provider,reason}.as_count()',
  monthToDate: (provider: string) =>
    `sum:macro.ai.usage.cost_usd{provider:${provider}}`,
};

const TITLES = {
  accountUnavailable: 'AI provider account suspended or out of credit',
  editingAccountUnavailable:
    'AI provider account suspended or out of credit for AI editing',
  nearingCap: (name: string) => `${name} spend nearing its monthly cap`,
  reachedCap: (name: string) => `${name} spend reached its monthly cap`,
};

const ACCOUNT_DESCRIPTION = `Macro's account with {{provider.name}} is refusing requests ({{reason.name}}), so every AI feature on that provider fails until billing is fixed.

- [Failure logs](https://us5.datadoghq.com/logs?query=%22ai%20provider%20account%20unavailable%22)
- Fix it in the provider's billing console: pay the invoice, add credit, or raise the spending limit.`;

export const dashboard = new datadog.Dashboard('ai-providers', {
  title: 'AI providers',
  description:
    'Provider account failures and month-to-date AI spend against provider caps. Declared in infra/stacks/monitoring/monitors/ai-providers.ts; see docs/runbooks/ai-providers.md.',
  layoutType: 'ordered',
  widgets: [
    graphGroup('Account failures', [
      thresholdGraph({
        title: TITLES.accountUnavailable,
        query: QUERIES.accountUnavailable,
        critical: '1',
      }),
      thresholdGraph({
        title: TITLES.editingAccountUnavailable,
        query: QUERIES.editingAccountUnavailable,
        critical: '1',
      }),
    ]),
    graphGroup('Spend', [
      {
        timeseriesDefinition: {
          title: 'Priced AI spend (USD) by provider',
          showLegend: true,
          requests: [
            {
              q: 'sum:macro.ai.usage.cost_usd{*} by {provider}.rollup(sum, 86400)',
              displayType: 'bars',
            },
          ],
        },
      },
      ...MONTHLY_CAPS.flatMap(({ provider, name, usd: cap }) => {
        const query = `cumsum(${QUERIES.monthToDate(provider)}.rollup(sum, 3600))`;
        // cumsum() counts from the start of the window, so the window must be
        // the monitors' calendar month whatever range the dashboard shows.
        const liveSpan = 'month_to_date';
        return [
          thresholdGraph({
            title: TITLES.nearingCap(name),
            query,
            critical: String(cap * 0.8),
            warning: String(cap * 0.5),
            liveSpan,
          }),
          thresholdGraph({
            title: TITLES.reachedCap(name),
            query,
            critical: String(cap),
            liveSpan,
          }),
        ];
      }),
    ]),
  ],
});

prodMonitor('ai-provider-account-unavailable', {
  title: TITLES.accountUnavailable,
  service: 'agent-harness-service',
  query: `sum(last_5m):${QUERIES.accountUnavailable} >= 1`,
  monitorThresholds: { critical: '1' },
  // Every request on that provider fails until a person fixes billing.
  pages: true,
  description: ACCOUNT_DESCRIPTION,
  runbook: `${RUNBOOK}#account-suspended-or-out-of-credit`,
  dashboard: dashboard.url,
  alertDetail: '{{provider.name}} refused {{value}} requests ({{reason.name}})',
  recoveryDetail: '{{provider.name}} is serving requests again',
});

prodMonitor('ai-editing-provider-account-unavailable', {
  title: TITLES.editingAccountUnavailable,
  service: 'ai-editing-worker',
  query: `sum(last_5m):${QUERIES.editingAccountUnavailable} >= 1`,
  monitorThresholds: { critical: '1' },
  // The editing worker falls back to the next model in its chain, so a
  // refused account degrades edits rather than failing them; the Rust
  // monitor pages for the same account.
  pages: false,
  description: ACCOUNT_DESCRIPTION,
  runbook: `${RUNBOOK}#account-suspended-or-out-of-credit`,
  dashboard: dashboard.url,
  alertDetail: '{{provider.name}} refused {{value}} edit requests ({{reason.name}})',
  recoveryDetail: '{{provider.name}} is serving edit requests again',
});

for (const { provider, name, usd: cap } of MONTHLY_CAPS) {
  // Calendar month to date: provider caps reset on the 1st (UTC).
  const spend = `sum(current_1mo):${QUERIES.monthToDate(provider)}`;
  const description = `Priced ${name} spend this month is \${{value}} against its $${cap} monthly cap. At the cap ${name} suspends the account and every request on it fails.

Raise the cap in ${name}'s billing console, then update MONTHLY_CAPS in infra/stacks/monitoring/monitors/ai-providers.ts. Priced spend is Macro's estimate from ai_pricing; the console is the source of truth.`;

  prodMonitor(`ai-${provider}-spend-nearing-cap`, {
    title: TITLES.nearingCap(name),
    service: 'agent-harness-service',
    query: `${spend} >= ${cap * 0.8}`,
    monitorThresholds: {
      critical: String(cap * 0.8),
      warning: String(cap * 0.5),
    },
    pages: false,
    description,
    runbook: `${RUNBOOK}#spend-nearing-or-at-a-cap`,
    dashboard: dashboard.url,
    alertDetail: '${{value}} spent, 80% of the cap',
    warningDetail: '${{value}} spent, 50% of the cap',
    recoveryDetail: '${{value}} spent',
  });

  prodMonitor(`ai-${provider}-spend-reached-cap`, {
    title: TITLES.reachedCap(name),
    service: 'agent-harness-service',
    query: `${spend} >= ${cap}`,
    monitorThresholds: { critical: String(cap) },
    pages: false,
    description,
    runbook: `${RUNBOOK}#spend-nearing-or-at-a-cap`,
    dashboard: dashboard.url,
    alertDetail: '${{value}} spent, at the cap',
    recoveryDetail: '${{value}} spent',
  });
}
