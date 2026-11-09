// Routine suggestions in agent-harness-service: hidden agent sessions that
// suggest routines once a person's inbox connects, and what people save and
// dismiss from them.
//
// Every metric below is built from INFO logs that
// `crates/agents/scheduled_action/src/domain/suggestions.rs` and `service.rs` emit,
// keyed by `event`, so these fields are their contract with this file;
// renaming one there silently empties a widget or turns the monitor into
// missing data:
//
// - `routine_suggestions.generated`, once per generation: `outcome`
//   (`ready` | `partial` | `failed` | `cancelled`), `sessions`, `kept`,
//   `retries`, `inbox_messages`, `surfaces_filled` (of 9), `first_ms` (absent
//   when nothing was kept), `duration_ms`. `failed` means no session suggested
//   anything after one retry, so the person gets Macro's templates only.
// - `routine_suggestions.surface`, once per surface per generation: `outcome`,
//   `surface`, `filled` (AI suggested at least one routine for it),
//   `suggestions`.
// - `routine_suggestions.suggested`, once per `macro.routines.suggest` call:
//   `kind` (`catalog` | `routine`), `surface`, `ok` (kept, or rejected by its
//   checks), `problems`.
// - `routine_suggestions.dismissed`: `from` (`for_you` | `macro`), `kind`,
//   `surface`.
// - `routine_suggestions.saved`, a routine saved from a suggestion: `from`,
//   `kind`, `surface` (absent if the suggestion could not be read), `enabled`.
//
// Each generation is one trace under the `routine.suggestions.generate` span,
// with a `routine.suggestions.session` span per session and a
// `routine.suggestions.suggest` span per call; see the runbook. No field holds
// a user id, mail or prompt text.
import * as datadog from '@pulumi/datadog';
import { graphGroup, prodMonitor, thresholdGraph } from '../prod-monitor';

type LogGroupBy = datadog.types.input.LogsMetricGroupBy;

const SERVICE = 'agent-harness-service';
const tag = (field: string): LogGroupBy => ({
  path: `@${field}`,
  tagName: field,
});
const ENV: LogGroupBy = { path: 'env', tagName: 'env' };
const logs = (event: string) =>
  `service:${SERVICE} status:info @event:routine_suggestions.${event}`;

new datadog.LogsMetric('routine-suggestions-generation', {
  name: 'macro.routine_suggestions.generation',
  compute: { aggregationType: 'count' },
  filter: { query: logs('generated') },
  groupBies: [ENV, tag('outcome')],
});

// Percentiles over generations; `first_ms` only from those that kept one.
for (const field of ['first_ms', 'duration_ms', 'surfaces_filled']) {
  new datadog.LogsMetric(`routine-suggestions-${field.replaceAll('_', '-')}`, {
    name: `macro.routine_suggestions.${field}`,
    compute: {
      aggregationType: 'distribution',
      path: `@${field}`,
      includePercentiles: true,
    },
    filter: { query: logs('generated') },
    groupBies: [ENV, tag('outcome')],
  });
}

new datadog.LogsMetric('routine-suggestions-surface', {
  name: 'macro.routine_suggestions.surface',
  compute: { aggregationType: 'count' },
  filter: { query: logs('surface') },
  groupBies: [ENV, tag('surface'), tag('filled')],
});

new datadog.LogsMetric('routine-suggestions-suggested', {
  name: 'macro.routine_suggestions.suggested',
  compute: { aggregationType: 'count' },
  filter: { query: logs('suggested') },
  groupBies: [ENV, tag('kind'), tag('surface'), tag('ok')],
});

for (const event of ['dismissed', 'saved']) {
  new datadog.LogsMetric(`routine-suggestions-${event}`, {
    name: `macro.routine_suggestions.${event}`,
    compute: { aggregationType: 'count' },
    filter: { query: logs(event) },
    groupBies: [ENV, tag('from'), tag('kind'), tag('surface')],
  });
}

const RUNBOOK = 'docs/runbooks/routine-suggestions.md';

const GENERATION = (tags: string) =>
  `sum:macro.routine_suggestions.generation{${tags}}.as_count()`;

// Failed generations over all that finished; a shutdown cancels the rest.
// The +20 keeps a few failures at low volume from alerting: it fires once
// more than 10% of generations, plus 2, fail.
const FAILURE_FLOOR = 20;
const FAILURE_RATE = `${GENERATION('env:prod,outcome:failed')} / (${GENERATION('env:prod,!outcome:cancelled')} + ${FAILURE_FLOOR})`;
const FAILURE_TITLE = 'Routine suggestion generations failing';

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
const COUNT = (metric: string, tags = ENV_VALUE, by = '') =>
  `sum:macro.routine_suggestions.${metric}{${tags}}${by ? ` by {${by}}` : ''}.as_count()`;

const dashboard = new datadog.Dashboard('routine-suggestions', {
  title: 'Routine suggestions',
  description:
    'Routine suggestions in agent-harness-service: generations, time to first suggestion, per-surface fill, rejected suggestions, the fallback to Macro templates, and saves and dismissals by surface and kind. Declared in infra/stacks/monitoring/monitors/routine-suggestions.ts; see docs/runbooks/routine-suggestions.md.',
  layoutType: 'ordered',
  templateVariables: [{ name: 'env', prefix: 'env', default: 'prod' }],
  widgets: [
    graphGroup('Generations', [
      lines(
        'Generations by outcome',
        COUNT('generation', ENV_VALUE, 'outcome'),
        'bars'
      ),
      lines(
        'Fallback rate: generations with only Macro templates (failed / finished)',
        `${COUNT('generation', `${ENV_VALUE},outcome:failed`)} / ${COUNT('generation', `${ENV_VALUE},!outcome:cancelled`)}`
      ),
      lines(
        'Time to first suggestion (s), p50 and p95',
        `p50:macro.routine_suggestions.first_ms{${ENV_VALUE}} / 1000, p95:macro.routine_suggestions.first_ms{${ENV_VALUE}} / 1000`
      ),
      lines(
        'Generation duration (s) by outcome, p95',
        `p95:macro.routine_suggestions.duration_ms{${ENV_VALUE}} by {outcome} / 1000`
      ),
      lines(
        'Surfaces AI filled per generation (of 9), median',
        `p50:macro.routine_suggestions.surfaces_filled{${ENV_VALUE},!outcome:cancelled}`
      ),
    ]),
    graphGroup('Surfaces and suggestions', [
      lines(
        'Per-surface fill: generations where AI suggested for the surface',
        `${COUNT('surface', `${ENV_VALUE},filled:true`, 'surface')} / ${COUNT('surface', ENV_VALUE, 'surface')}`
      ),
      lines(
        'Suggestions handed back by kind and result',
        COUNT('suggested', ENV_VALUE, 'kind,ok'),
        'bars'
      ),
      lines(
        'Rejection rate by kind (failed checks / handed back)',
        `${COUNT('suggested', `${ENV_VALUE},ok:false`, 'kind')} / ${COUNT('suggested', ENV_VALUE, 'kind')}`
      ),
      lines(
        'Kept suggestions by surface',
        COUNT('suggested', `${ENV_VALUE},ok:true`, 'surface'),
        'bars'
      ),
      {
        listStreamDefinition: {
          title: 'Rejected suggestions',
          requests: [
            {
              responseFormat: 'event_list',
              query: {
                dataSource: 'logs_stream',
                queryString: `${logs('suggested')} @ok:false ${ENV_VALUE}`,
                indexes: ['*'],
                sort: { column: 'timestamp', order: 'desc' },
              },
              columns: [
                { field: 'timestamp', width: 'auto' },
                { field: '@kind', width: 'auto' },
                { field: '@surface', width: 'auto' },
                { field: '@problems', width: 'auto' },
              ],
            },
          ],
        },
      },
    ]),
    graphGroup('Saved and dismissed', [
      lines(
        'Saved by surface, from and kind',
        COUNT('saved', ENV_VALUE, 'surface,from,kind'),
        'bars'
      ),
      lines(
        'Dismissed by surface, from and kind',
        COUNT('dismissed', ENV_VALUE, 'surface,from,kind'),
        'bars'
      ),
      lines(
        'Accept rate by from and kind (saved / saved + dismissed)',
        `${COUNT('saved', ENV_VALUE, 'from,kind')} / (${COUNT('saved', ENV_VALUE, 'from,kind')} + ${COUNT('dismissed', ENV_VALUE, 'from,kind')})`
      ),
    ]),
    graphGroup('Alerts (prod)', [
      thresholdGraph({
        // Hourly sums, as the monitor evaluates them.
        title: FAILURE_TITLE,
        query: FAILURE_RATE.replaceAll(
          '.as_count()',
          '.as_count().rollup(sum, 3600)'
        ),
        critical: '0.1',
      }),
    ]),
  ],
});

// Routine suggestions are behind the `enable-routine-suggestions` flag, so
// this notifies and does not page. A failed generation still serves Macro's
// templates; the person sees no AI suggestions.
prodMonitor('routine-suggestions-failures', {
  title: FAILURE_TITLE,
  service: SERVICE,
  query: `sum(last_1h):${FAILURE_RATE} > 0.1`,
  monitorThresholds: { critical: '0.1' },
  pages: false,
  description: `{{value}} of routine suggestion generations in the last hour failed (beyond a ${FAILURE_FLOOR}-generation floor): no session suggested anything after a retry, so those people get Macro's templates only.`,
  dashboard: dashboard.url,
  runbook: `${RUNBOOK}#generations-failing`,
  alertDetail: '{{value}} of generations failed (threshold {{threshold}})',
});
