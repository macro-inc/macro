// Agent runtimes in agent-harness-service: reattach storms when a runtime
// dials in again, and the tokio runtime starving under them.
//
// New monitors, not adopted. The fields below are their contract; renaming
// one silently empties a metric and turns its monitor into missing data:
//
// - The `agent.runtime.reattach` span (`reattach_live_sessions` in
//   `crates/agents/agent_harness/src/domain/service.rs`), one per dial of a runtime
//   that lists live sessions: `harness` (opaque harness uuid) and
//   `agent.runtime.reattach_sessions` (sessions bound to it),
//   `.reattach_eager`, `.reattach_lazy`, `.reattach_skipped` and
//   `.reattach_failures` (how each was handled).
// - The `tokio runtime starvation detected` warning from
//   `spawn_starvation_detector` in `crates/platform/macro_tower_layers/src/lib.rs`,
//   logged when a 250 ms tick runs late.
//
// Thresholds come from the seven days to 2026-11-10 (see each monitor).
import * as datadog from '@pulumi/datadog';
import { graphGroup, prodMonitor, thresholdGraph } from '../prod-monitor';

const SERVICE = 'agent-harness-service';
const ENV = { path: 'env', tagName: 'env' };
const HARNESS = { path: '@harness', tagName: 'harness' };
const REATTACH = `service:${SERVICE} resource_name:agent.runtime.reattach`;

new datadog.SpansMetric('agent-runtime-reattach', {
  name: 'macro.agent_harness.runtime_reattach',
  filter: { query: REATTACH },
  compute: { aggregationType: 'count' },
  groupBies: [ENV, HARNESS],
});

// Per dial; read with `sum:` for sessions per window.
for (const field of ['sessions', 'eager', 'lazy', 'skipped', 'failures']) {
  new datadog.SpansMetric(`agent-runtime-reattach-${field}`, {
    name: `macro.agent_harness.runtime_reattach.${field}`,
    filter: { query: `${REATTACH} @agent.runtime.reattach_${field}:*` },
    compute: {
      aggregationType: 'distribution',
      path: `@agent.runtime.reattach_${field}`,
      includePercentiles: false,
    },
    groupBies: [ENV, HARNESS],
  });
}

new datadog.LogsMetric('agent-harness-runtime-starvation', {
  name: 'macro.agent_harness.runtime_starvation',
  compute: { aggregationType: 'count' },
  filter: {
    query: `service:${SERVICE} status:warn "tokio runtime starvation detected"`,
  },
  groupBies: [ENV],
});

const RUNBOOK = 'docs/runbooks/agent-harness-runtimes.md';

const QUERIES = {
  dials:
    'sum:macro.agent_harness.runtime_reattach{env:prod} by {harness}.as_count()',
  sessions:
    'sum:macro.agent_harness.runtime_reattach.sessions{env:prod} by {harness}',
  starvation: 'sum:macro.agent_harness.runtime_starvation{env:prod}.as_count()',
};

const TITLES = {
  dials: 'Agent runtime reattaching in a loop',
  sessions: 'Agent runtime reattaching too many sessions',
  starvation: 'Agent harness tokio runtime starving',
};

const THRESHOLDS = { dials: '15', sessions: '500', starvation: '1000' };

// 15-minute sums, as the monitors evaluate them.
const windowed = (query: string) => `${query}.rollup(sum, 900)`;

const lines = (
  title: string,
  q: string,
  displayType = 'line'
): datadog.types.input.DashboardWidget => ({
  timeseriesDefinition: {
    title,
    showLegend: true,
    requests: [{ q, displayType }],
  },
});

const ENV_VALUE = 'env:$env.value';
const outcome = (field: string) =>
  `sum:macro.agent_harness.runtime_reattach.${field}{${ENV_VALUE}}`;

const dashboard = new datadog.Dashboard('agent-harness-runtimes', {
  title: 'Agent harness runtimes',
  description:
    'Agent runtime reattach in agent-harness-service: dials and sessions per runtime, how sessions were handled, and tokio runtime starvation. Declared in infra/stacks/monitoring/monitors/harness-runtimes.ts; see docs/runbooks/agent-harness-runtimes.md.',
  layoutType: 'ordered',
  templateVariables: [{ name: 'env', prefix: 'env', default: 'prod' }],
  widgets: [
    graphGroup('Reattach', [
      lines(
        'Reattach dials by runtime',
        `sum:macro.agent_harness.runtime_reattach{${ENV_VALUE}} by {harness}.as_count()`,
        'bars'
      ),
      lines(
        'Sessions reattached by outcome',
        ['eager', 'lazy', 'skipped', 'failures']
          .map((field) => outcome(field))
          .join(', '),
        'bars'
      ),
      lines(
        'Tokio runtime starvation warnings',
        `sum:macro.agent_harness.runtime_starvation{${ENV_VALUE}}.as_count()`,
        'bars'
      ),
    ]),
    graphGroup('Alerts (prod)', [
      thresholdGraph({
        title: TITLES.dials,
        query: windowed(QUERIES.dials),
        critical: THRESHOLDS.dials,
      }),
      thresholdGraph({
        title: TITLES.sessions,
        query: windowed(QUERIES.sessions),
        critical: THRESHOLDS.sessions,
      }),
      thresholdGraph({
        title: TITLES.starvation,
        query: windowed(QUERIES.starvation),
        critical: THRESHOLDS.starvation,
      }),
    ]),
  ],
});

// A healthy runtime dials once per connection. Over the seven days to
// 2026-11-10 one runtime dialed at most 12 times in any 15 minutes outside
// reconnect loops, and 24 to 29 times during them.
prodMonitor('agent-runtime-reattach-dials', {
  title: TITLES.dials,
  service: SERVICE,
  query: `sum(last_15m):${QUERIES.dials} > ${THRESHOLDS.dials}`,
  monitorThresholds: { critical: THRESHOLDS.dials },
  pages: false,
  description:
    'Runtime {{harness.name}} dialed agent-harness-service {{value}} times in 15 minutes. Each dial reattaches every session it lists, so a reconnect loop loads the same sessions over and over.',
  dashboard: dashboard.url,
  runbook: `${RUNBOOK}#reattaching-in-a-loop`,
  alertDetail: '{{value}} dials in 15 minutes (threshold {{threshold}})',
});

// Outside storms one runtime listed at most 263 sessions in 15 minutes; on
// 2026-11-10 at 17:15Z one listed about 1,450, and a looping runtime about
// 1,600.
prodMonitor('agent-runtime-reattach-sessions', {
  title: TITLES.sessions,
  service: SERVICE,
  query: `sum(last_15m):${QUERIES.sessions} > ${THRESHOLDS.sessions}`,
  monitorThresholds: { critical: THRESHOLDS.sessions },
  pages: false,
  description:
    'Runtime {{harness.name}} listed {{value}} sessions to reattach in 15 minutes. Loading that many at once starves the replica it dialed.',
  dashboard: dashboard.url,
  runbook: `${RUNBOOK}#reattaching-too-many-sessions`,
  alertDetail: '{{value}} sessions in 15 minutes (threshold {{threshold}})',
});

// Quiet 15 minutes logged at most 451 warnings across replicas; reattach
// storms logged 1,000 to 2,400, about 2,400 on 2026-11-10 at 17:15Z.
prodMonitor('agent-harness-runtime-starvation', {
  title: TITLES.starvation,
  service: SERVICE,
  query: `sum(last_15m):${QUERIES.starvation} > ${THRESHOLDS.starvation}`,
  monitorThresholds: { critical: THRESHOLDS.starvation },
  pages: false,
  description:
    'agent-harness-service logged {{value}} tokio runtime starvation warnings in 15 minutes: its runtime threads are blocked, so requests, websockets and leases stall.',
  dashboard: dashboard.url,
  runbook: `${RUNBOOK}#tokio-runtime-starving`,
  alertDetail: '{{value}} warnings in 15 minutes (threshold {{threshold}})',
});
