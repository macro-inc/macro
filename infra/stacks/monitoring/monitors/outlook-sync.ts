// Outlook mailbox sync in the email-service pubsub workers: per-mailbox
// backlog, Graph throttling, token lookups and persistence deferrals.
//
// Every metric below is built from telemetry email-service emits, so these
// fields are its contract with this file; renaming one there silently empties
// a widget or turns a monitor into missing data:
//
// - The `outlook mailbox health` INFO log, about once a minute per Outlook
//   mailbox: `link_id`, `queued`, `parked`, `abandoned`, `oldest_waiting_seconds`,
//   `parked_until_max_seconds`, `imported_5m`, `seconds_since_last_import`
//   (numbers), `sync_active`, `needs_reauth` (booleans).
// - The `outlook import completed` INFO log: `link_id`, `sync_generation`,
//   `duration_seconds`, `messages`, `folders`, `graph_calls`.
// - Spans: `outlook.sync.{discover,enumerate,reconcile,project}` (internal, so
//   Datadog keeps the name as `resource_name`) with `outlook.outcome`
//   (`imported` | `absent` | `deferred` | `abandoned` | `failed`) and
//   `outlook.defer_reason`; `outlook.notification_lag_ms` on reconcile spans
//   (Graph change notification received to message imported); the
//   `outlook.subscription.{maintain,notify}` spans with `outlook.outcome`;
//   the Graph request span with `outlook.throttle_origin`
//   and `http.response.status_code`; the token lookup span with
//   `outlook.token_cache`, `outlook.outcome` (`ok` | `auth_required` |
//   `unavailable`) and `http.response.status_code`. Datadog stores
//   `http.response.status_code` as `@http.status_code`.
//
// Graph and token spans are matched by those fields, not by name: Datadog
// renames a client span that carries `http.request.method` to
// `http.client.request` with the method as its resource.
//
// Ids are opaque link uuids; never addresses or message content. Thresholds
// come from the first production import (two mailboxes, about 2,100 messages
// in 15 minutes on 2026-11-03); each monitor says how.
import * as datadog from '@pulumi/datadog';
import { graphGroup, prodMonitor, thresholdGraph } from '../prod-monitor';

type LogGroupBy = datadog.types.input.LogsMetricGroupBy;
type SpanGroupBy = datadog.types.input.SpansMetricGroupBy;

const ENV = { path: 'env', tagName: 'env' };

// Per mailbox, plus the two link states the monitors filter on.
const HEALTH_SPLITS: LogGroupBy[] = [
  ENV,
  { path: '@link_id', tagName: 'link_id' },
  { path: '@sync_active', tagName: 'sync_active' },
  { path: '@needs_reauth', tagName: 'needs_reauth' },
];

// One distribution per snapshot field. Read with max or min by link_id:
// several replicas may report the same mailbox.
for (const field of [
  'queued',
  'parked',
  'abandoned',
  'oldest_waiting_seconds',
  'seconds_since_last_import',
  'imported_5m',
  'parked_until_max_seconds',
]) {
  new datadog.LogsMetric(`outlook-mailbox-${field.replaceAll('_', '-')}`, {
    name: `macro.outlook.mailbox.${field}`,
    compute: { aggregationType: 'distribution', path: `@${field}` },
    filter: { query: 'status:info "outlook mailbox health"' },
    groupBies: HEALTH_SPLITS,
  });
}

const spanTag = (path: string): SpanGroupBy => ({
  path: `@${path}`,
  tagName: path,
});
const STATUS = spanTag('http.status_code');

// Span-based metrics count every ingested span, and the ratio monitors need
// every success, so Outlook spans must not be head-sampled (the field
// contract says so). They are ingested in full today: on 2026-11-03 the Graph
// errors in APM stats and in span search matched exactly.
const SYNC = 'resource_name:outlook.sync.*';
const GRAPH = '@outlook.throttle_origin:*';
const TOKEN = '@outlook.token_cache:*';
const SUBSCRIPTION = 'resource_name:outlook.subscription.*';

new datadog.SpansMetric('outlook-sync', {
  name: 'macro.outlook.sync',
  filter: { query: SYNC },
  compute: { aggregationType: 'count' },
  groupBies: [
    ENV,
    { path: 'resource_name', tagName: 'resource_name' },
    spanTag('outlook.outcome'),
    spanTag('outlook.defer_reason'),
  ],
});

// How long a change Graph announced took to import, including retries.
// Messages queued by polling or an initial import carry no lag.
new datadog.SpansMetric('outlook-notification-lag', {
  name: 'macro.outlook.notification_lag',
  filter: {
    query:
      'resource_name:outlook.sync.reconcile @outlook.notification_lag_ms:*',
  },
  compute: {
    aggregationType: 'distribution',
    path: '@outlook.notification_lag_ms',
    includePercentiles: true,
  },
  groupBies: [ENV, spanTag('outlook.outcome')],
});

// Counts come from `count:`; latency includes any wait for the mailbox gate.
new datadog.SpansMetric('outlook-graph-request', {
  name: 'macro.outlook.graph_request',
  filter: { query: GRAPH },
  compute: {
    aggregationType: 'distribution',
    path: '@duration',
    includePercentiles: true,
  },
  groupBies: [ENV, STATUS, spanTag('outlook.throttle_origin')],
});

new datadog.SpansMetric('outlook-token-acquire', {
  name: 'macro.outlook.token.acquire',
  filter: { query: TOKEN },
  compute: { aggregationType: 'count' },
  groupBies: [
    ENV,
    spanTag('outlook.outcome'),
    spanTag('outlook.token_cache'),
    STATUS,
  ],
});

// Keeps every failed, deferred, throttled or slow Outlook span searchable,
// with the rest of its trace. Successes are left to the default sampling.
new datadog.ApmRetentionFilter('outlook-sync-traces', {
  name: 'Outlook sync failures, deferrals and slow work',
  enabled: true,
  filterType: 'spans-sampling-processor',
  filter: {
    query: `(${SYNC} OR ${SUBSCRIPTION} OR ${GRAPH} OR ${TOKEN}) (status:error OR @duration:>5s OR @outlook.outcome:(deferred OR failed OR auth_required OR unavailable) OR @outlook.throttle_origin:(gate OR graph))`,
  },
  rate: '1.0',
  traceRate: '1.0',
});

const HEALTH_PROD = 'env:prod,sync_active:true,needs_reauth:false';
const MAILBOX = (field: string, tags = 'env:$env.value') =>
  `macro.outlook.mailbox.${field}{${tags}} by {link_id}`;

// The monitors' metric expressions, graphed on the dashboard as written.
const QUERIES = {
  // 1 while a message has been claimable for 5 minutes and nothing imported
  // in the 5 minutes before the snapshot; 0 or less otherwise.
  stalled: `clamp_max(min:${MAILBOX('oldest_waiting_seconds', HEALTH_PROD)}.rollup(min, 60) / 300, 1) - clamp_max(max:${MAILBOX('imported_5m', HEALTH_PROD)}.rollup(max, 60), 1)`,
  parked: `max:${MAILBOX('parked_until_max_seconds', 'env:prod')}`,
  graphThrottled:
    'count:macro.outlook.graph_request{env:prod,outlook.throttle_origin:graph}.as_count() / (count:macro.outlook.graph_request{env:prod,!outlook.throttle_origin:gate}.as_count() + 100)',
  tokenFailures:
    'sum:macro.outlook.token.acquire{env:prod,outlook.outcome:unavailable}.as_count() / (sum:macro.outlook.token.acquire{env:prod}.as_count() + 100)',
  // Mailboxes needing reauthorization; each snapshot lands in its 5-minute bucket.
  reauth: `count_not_null(max:${MAILBOX('queued', 'env:prod,needs_reauth:true')}.rollup(max, 300))`,
  // Database failures only: projection reports failed Kafka, SQS and HTTP
  // effects as `effect`.
  persistence:
    'sum:macro.outlook.sync{env:prod,outlook.defer_reason:persistence}.as_count()',
};

const RUNBOOK = 'docs/runbooks/outlook-sync.md';

const TITLES = {
  stalled: 'Outlook mailbox sync stalled',
  parked: 'Outlook message parked too long',
  graphThrottled: 'Outlook Graph throttling mailbox sync',
  tokenFailures: 'Outlook token lookups failing',
  reauth: 'Outlook mailboxes newly needing reauthorization',
  persistence: 'Outlook sync deferred on persistence errors',
};

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

const COMPLETED = 'status:info "outlook import completed" env:$env.value';
const importComputes = (field: string) => ({
  dataSource: 'logs',
  name: field,
  computes: [{ aggregation: 'max', metric: `@${field}` }],
  search: { query: COMPLETED },
  indexes: ['*'],
  groupBies: [
    { facet: '@link_id', limit: 100 },
    { facet: '@sync_generation', limit: 10 },
  ],
});

const dashboard = new datadog.Dashboard('outlook-sync', {
  title: 'Outlook sync',
  description:
    'Outlook mailbox sync in the email-service pubsub workers: progress, deferrals, Graph, tokens, imports, and every Outlook monitor against its thresholds. Declared in infra/stacks/monitoring/monitors/outlook-sync.ts; see docs/runbooks/outlook-sync.md.',
  layoutType: 'ordered',
  templateVariables: [{ name: 'env', prefix: 'env', default: 'prod' }],
  widgets: [
    graphGroup('Progress', [
      lines(
        'Imports per second',
        'sum:macro.outlook.sync{env:$env.value,resource_name:outlook.sync.reconcile,outlook.outcome:imported}.as_rate()'
      ),
      lines('Claimable messages by mailbox', `max:${MAILBOX('queued')}`),
      lines('Parked messages by mailbox', `max:${MAILBOX('parked')}`),
      lines('Abandoned messages by mailbox', `max:${MAILBOX('abandoned')}`),
      lines(
        'Oldest claimable message (s) by mailbox',
        `max:${MAILBOX('oldest_waiting_seconds')}`
      ),
      lines(
        'Seconds since the last import by mailbox',
        `min:${MAILBOX('seconds_since_last_import')}`
      ),
      lines(
        'Sync work by step and outcome',
        'sum:macro.outlook.sync{env:$env.value} by {resource_name,outlook.outcome}.as_count()',
        'bars'
      ),
    ]),
    graphGroup('Deferrals', [
      lines(
        'Deferrals by reason',
        'sum:macro.outlook.sync{env:$env.value,outlook.outcome:deferred} by {outlook.defer_reason}.as_count()',
        'bars'
      ),
      lines(
        'Failed sync work by step',
        'sum:macro.outlook.sync{env:$env.value,outlook.outcome:failed} by {resource_name}.as_count()',
        'bars'
      ),
    ]),
    graphGroup('Graph', [
      lines(
        'Graph requests by status',
        'count:macro.outlook.graph_request{env:$env.value} by {http.status_code}.as_count()',
        'bars'
      ),
      lines(
        'Throttled Graph requests by origin (gate refused, or Graph answered 429)',
        'count:macro.outlook.graph_request{env:$env.value,!outlook.throttle_origin:none} by {outlook.throttle_origin}.as_count()',
        'bars'
      ),
      lines(
        'Graph request p95 (ms), requests that reached Graph',
        'p95:macro.outlook.graph_request{env:$env.value,!outlook.throttle_origin:gate} by {http.status_code} / 1000000'
      ),
    ]),
    graphGroup('Tokens', [
      lines(
        'Token lookups by outcome and cache',
        'sum:macro.outlook.token.acquire{env:$env.value} by {outlook.outcome,outlook.token_cache}.as_count()',
        'bars'
      ),
      lines(
        'Token lookup failures by authentication-service status',
        'sum:macro.outlook.token.acquire{env:$env.value,!outlook.outcome:ok} by {outlook.outcome,http.status_code}.as_count()',
        'bars'
      ),
    ]),
    graphGroup('Imports', [
      {
        scatterplotDefinition: {
          title: 'Time to import (s) against messages, per completed import',
          request: {
            scatterplotTables: [
              {
                queries: [
                  { eventQuery: importComputes('messages') },
                  { eventQuery: importComputes('duration_seconds') },
                ],
                formulas: [
                  { dimension: 'x', formulaExpression: 'messages' },
                  { dimension: 'y', formulaExpression: 'duration_seconds' },
                ],
              },
            ],
          },
          xaxis: { label: 'messages' },
          yaxis: { label: 'seconds' },
        },
      },
      {
        listStreamDefinition: {
          title: 'Completed imports',
          requests: [
            {
              responseFormat: 'event_list',
              query: {
                dataSource: 'logs_stream',
                queryString: COMPLETED,
                indexes: ['*'],
                sort: { column: 'timestamp', order: 'desc' },
              },
              columns: [
                { field: 'timestamp', width: 'auto' },
                { field: '@link_id', width: 'auto' },
                { field: '@messages', width: 'auto' },
                { field: '@folders', width: 'auto' },
                { field: '@graph_calls', width: 'auto' },
                { field: '@duration_seconds', width: 'auto' },
              ],
            },
          ],
        },
      },
    ]),
    graphGroup('Alerts (prod)', [
      thresholdGraph({
        title: TITLES.stalled,
        query: QUERIES.stalled,
        critical: '1',
      }),
      thresholdGraph({
        title: TITLES.parked,
        query: QUERIES.parked,
        critical: '1800',
        warning: '900',
      }),
      thresholdGraph({
        // Fifteen-minute sums, as the monitor evaluates them.
        title: TITLES.graphThrottled,
        query: `${QUERIES.graphThrottled.replaceAll('.as_count()', '.as_count().rollup(sum, 900)')}`,
        critical: '0.1',
        warning: '0.02',
      }),
      thresholdGraph({
        title: TITLES.tokenFailures,
        query: `${QUERIES.tokenFailures.replaceAll('.as_count()', '.as_count().rollup(sum, 3600)')}`,
        critical: '0.05',
        warning: '0.01',
      }),
      thresholdGraph({
        // The change the monitor alerts on: now against an hour ago.
        title: TITLES.reauth,
        query: `${QUERIES.reauth} - timeshift(${QUERIES.reauth}, -3600)`,
        critical: '3',
        warning: '1',
      }),
      thresholdGraph({
        title: TITLES.persistence,
        query: `${QUERIES.persistence}.rollup(sum, 900)`,
        critical: '500',
        warning: '150',
      }),
    ]),
  ],
});

// For 10 minutes, every snapshot showed a message claimable for at least 5
// minutes and no import in the 5 minutes before it: nothing imported for 15
// minutes while a message waited 15. The 5-minute floor keeps a new link's
// first snapshots (fresh backlog, nothing imported yet) from alerting on a
// partial window. Links that need reauthorization stall by design and have
// their own monitor.
prodMonitor('outlook-mailbox-stalled', {
  title: TITLES.stalled,
  service: 'email-service',
  query: `min(last_10m):${QUERIES.stalled} >= 1`,
  monitorThresholds: { critical: '1' },
  pages: false,
  description:
    'Mailbox {{link_id.name}} has had a message claimable for 15 minutes and imported none in that time. The first production import moved about 2,100 messages in 15 minutes. Throttled messages are parked, not claimable, so this means claims stopped.',
  dashboard: dashboard.url,
  runbook: `${RUNBOOK}#stalled-mailbox`,
  alertDetail: 'mailbox {{link_id.name}} stalled',
  recoveryDetail: 'mailbox {{link_id.name}} importing again or idle',
});

// The mailbox gate parks a refused message until a slot frees, at most the
// 10-minute window; persistence failures park for 30 s and reauthorization
// for 5 minutes. Only a long Graph Retry-After, which the worker honours for
// up to a day, parks past 30 minutes (3 gate windows).
prodMonitor('outlook-message-parked-too-long', {
  title: TITLES.parked,
  service: 'email-service',
  query: `max(last_5m):${QUERIES.parked} > 1800`,
  monitorThresholds: { critical: '1800', warning: '900' },
  pages: false,
  description:
    'A message in mailbox {{link_id.name}} is parked {{value}} seconds into the future. Gate refusals park for at most the 10-minute window, so this is a Graph Retry-After or a bug; those messages stay invisible until then.',
  dashboard: dashboard.url,
  runbook: `${RUNBOOK}#parked-too-long`,
});

// The gate holds each mailbox to 9,000 of Graph's 10,000 requests per 10
// minutes and 3 of its 4 concurrent requests, so Graph itself should not
// throttle. On 2026-11-03, 2,673 of 15,996 Graph requests failed as rate
// limited, and every one whose cause was logged (2,922 warnings) was a gate
// refusal; none came from Graph. The +100 keeps a handful of 429s at low
// volume from alerting: it fires once Graph throttles 10% of the requests
// that reached it, plus 10.
prodMonitor('outlook-graph-throttling', {
  title: TITLES.graphThrottled,
  service: 'email-service',
  query: `sum(last_15m):${QUERIES.graphThrottled} > 0.1`,
  monitorThresholds: { critical: '0.1', warning: '0.02' },
  pages: false,
  description:
    'Graph throttled {{value}} of the Outlook requests that reached it in 15 minutes (beyond a 100-request floor). The mailbox gate should keep Graph from throttling at all, so its limits no longer match what Graph enforces.',
  dashboard: dashboard.url,
  runbook: `${RUNBOOK}#graph-throttling`,
  alertDetail:
    '{{value}} of Graph requests throttled (threshold {{threshold}})',
  warningDetail:
    '{{value}} of Graph requests throttled (warning threshold {{warn_threshold}})',
});

// Every Outlook token lookup asks authentication-service. In the import's
// first hour it answered 17 of 14,210 Microsoft token lookups with 503
// (0.12%; APM stats, every caller), then 3 of 8,205. Warning is about 8 times
// that worst hour, critical 40 times. The +100 keeps a few failures from
// alerting when lookups are rare.
prodMonitor('outlook-token-failures', {
  title: TITLES.tokenFailures,
  service: 'email-service',
  query: `sum(last_1h):${QUERIES.tokenFailures} > 0.05`,
  monitorThresholds: { critical: '0.05', warning: '0.01' },
  pages: false,
  description:
    'authentication-service could not supply {{value}} of the Microsoft tokens Outlook sync asked for in the last hour (beyond a 100-lookup floor); normal is about 0.1%. Each failure defers sync work for its mailbox.',
  dashboard: dashboard.url,
  runbook: `${RUNBOOK}#token-failures`,
  alertDetail: '{{value}} of token lookups failed (threshold {{threshold}})',
  warningDetail:
    '{{value}} of token lookups failed (warning threshold {{warn_threshold}})',
});

// A mailbox that needs reauthorization keeps deferring every message, so
// deferral counts scale with its backlog; this counts mailboxes instead. A
// single user reconnecting is routine; several mailboxes flipping within an
// hour point at the app registration, the grant store or a refresh bug. None
// needed reauthorization on 2026-11-03, so these are starting points.
prodMonitor('outlook-reauthorization-spike', {
  title: TITLES.reauth,
  service: 'email-service',
  query: `change(max(last_10m),last_1h):${QUERIES.reauth} > 3`,
  monitorThresholds: { critical: '3', warning: '1' },
  pages: false,
  description:
    '{{value}} more Outlook mailboxes need reauthorization than an hour ago. Their sync stops until each user reconnects.',
  dashboard: dashboard.url,
  runbook: `${RUNBOOK}#reauthorization`,
  alertDetail: '{{value}} more mailboxes (threshold {{threshold}})',
  warningDetail:
    '{{value}} more mailboxes (warning threshold {{warn_threshold}})',
});

// On 2026-11-03, 179 sync units were deferred as "mailbox persistence is
// unavailable" in the import's worst 15 minutes (02:10-02:25), then 2. Warning
// would have flagged that burst; critical is nearly three times it.
prodMonitor('outlook-persistence-errors', {
  title: TITLES.persistence,
  service: 'email-service',
  query: `sum(last_15m):${QUERIES.persistence} > 500`,
  monitorThresholds: { critical: '500', warning: '150' },
  pages: false,
  description:
    '{{value}} units of Outlook sync work were deferred in 15 minutes because their database writes failed. Each retries after 30 seconds.',
  dashboard: dashboard.url,
  runbook: `${RUNBOOK}#persistence-errors`,
});
