// Web app performance: which flows are slow, for whom, and where the time goes.
//
// The web app exports perf-class traces for 5% of production users (see
// docs/agent-guide/observability.md#span-model). Datadog indexes only a sample
// of ingested spans, so this file adds a retention filter for those traces and
// span-based metrics computed from every ingested perf span; the dashboard
// reads the metrics. Root spans are also covered by APM trace metrics
// (trace.Internal by resource_name and version), which need no setup.
//
// Every attribute named here is set by apps/web/src/observability and
// packages/observability; renaming one there silently empties its widgets.
import * as datadog from '@pulumi/datadog';
import { graphGroup } from '../prod-monitor';

const WEB = 'service:web-app @macro.sampling.class:perf';

// Keeps every exported perf trace searchable, with the backend spans that
// joined it. Perf traces are already sampled to 5% of production users.
new datadog.ApmRetentionFilter('web-app-perf-traces', {
  name: 'web-app perf traces',
  enabled: true,
  filterType: 'spans-sampling-processor',
  filter: { query: WEB },
  rate: '1.0',
  traceRate: '1.0',
});

type GroupBy = datadog.types.input.SpansMetricGroupBy;

const tag = (path: string): GroupBy => ({ path: `@${path}`, tagName: path });
const SPLITS: GroupBy[] = [
  { path: 'env', tagName: 'env' },
  { path: 'resource_name', tagName: 'resource_name' },
  tag('app.platform'),
  tag('os.type'),
];

function distribution(
  name: string,
  query: string,
  path: string,
  groupBies: GroupBy[]
): datadog.SpansMetric {
  return new datadog.SpansMetric(name, {
    name,
    filter: { query },
    compute: {
      aggregationType: 'distribution',
      path,
      includePercentiles: true,
    },
    groupBies,
  });
}

// Roots: app.boot, navigation, interactions and views that started their own
// trace. ui.elapsed_ms is the root's duration in milliseconds.
distribution(
  'macro.web.flow.elapsed_ms',
  `${WEB} @flow.kind:*`,
  '@ui.elapsed_ms',
  [...SPLITS, tag('flow.kind'), tag('route.id'), tag('ui.outcome')]
);
// Main-thread blocking during each root (overlapping long animation frames).
distribution(
  'macro.web.flow.blocking_ms',
  `${WEB} @flow.kind:* @ui.outcome:success`,
  '@ui.long_animation_frame_blocking_ms',
  [...SPLITS, tag('flow.kind')]
);
// Every view, whether a root or a phase of a navigation. @duration is in
// nanoseconds.
distribution(
  'macro.web.view.duration',
  `${WEB} resource_name:view.* -@flow.outcome:cancelled -@ui.outcome:(cancelled OR hidden OR timeout)`,
  '@duration',
  [...SPLITS, tag('route.id')]
);
// Phases that completed, by the root they belong to.
distribution(
  'macro.web.phase.duration',
  `${WEB} @flow.root:* @flow.outcome:success`,
  '@duration',
  [...SPLITS, tag('flow.root')]
);
distribution(
  'macro.web.runtime.js_heap_used_bytes',
  `${WEB} resource_name:app.runtime.sample`,
  '@macro.memory.js_heap.used_bytes',
  [...SPLITS, tag('app.runtime')]
);
distribution(
  'macro.web.runtime.blocking_ms',
  `${WEB} resource_name:app.runtime.sample`,
  '@runtime.long_animation_frame.blocking_ms',
  [...SPLITS, tag('app.runtime')]
);
distribution(
  'macro.web.typing.event_duration_p95_ms',
  `${WEB} resource_name:input.typing_burst`,
  '@typing.event_duration_p95_ms',
  [...SPLITS, tag('typing.surface')]
);

const FILTER = '{env:$env.value,app.platform:$platform.value,os.type:$os.value';
const scope = (extra = '') => `${FILTER}${extra ? `,${extra}` : ''}}`;
const MS = ' / 1000000';

function toplist(
  title: string,
  q: string
): datadog.types.input.DashboardWidget {
  return { toplistDefinition: { title, requests: [{ q }] } };
}

function lines(title: string, q: string): datadog.types.input.DashboardWidget {
  return {
    timeseriesDefinition: {
      title,
      showLegend: true,
      requests: [{ q, displayType: 'line' }],
    },
  };
}

export const webPerformanceDashboard = new datadog.Dashboard(
  'web-performance',
  {
    title: 'Web app performance',
    description:
      'Perf-class traces from the web and desktop app (5% of production users, rotating weekly). Declared in infra/stacks/monitoring/dashboards/web-performance.ts; span names and attributes are in docs/agent-guide/observability.md#span-model, and the perf-investigation skill drills into a slow flow.',
    layoutType: 'ordered',
    templateVariables: [
      { name: 'env', prefix: 'env', default: 'prod' },
      { name: 'platform', prefix: 'app.platform', default: '*' },
      { name: 'os', prefix: 'os.type', default: '*' },
    ],
    widgets: [
      graphGroup('Slowest flows', [
        toplist(
          'Views: p75 load (ms) by route',
          `top(p75:macro.web.view.duration${scope()} by {route.id}${MS}, 25, 'mean', 'desc')`
        ),
        toplist(
          'Views: p95 load (ms) by route',
          `top(p95:macro.web.view.duration${scope()} by {route.id}${MS}, 25, 'mean', 'desc')`
        ),
        toplist(
          'Interactions: p95 (ms) by name',
          `top(p95:macro.web.flow.elapsed_ms${scope('flow.kind:interaction,ui.outcome:success')} by {resource_name}, 25, 'mean', 'desc')`
        ),
        toplist(
          'Flow volume by name',
          `top(count:macro.web.flow.elapsed_ms${scope()} by {resource_name}.as_count(), 25, 'sum', 'desc')`
        ),
      ]),
      graphGroup('Boot and navigation', [
        lines(
          'app.boot p75 (ms) by platform and OS',
          `p75:macro.web.flow.elapsed_ms${scope('resource_name:app.boot,ui.outcome:success')} by {app.platform,os.type}`
        ),
        lines(
          'navigation p75 (ms) by platform and OS',
          `p75:macro.web.flow.elapsed_ms${scope('resource_name:navigation,ui.outcome:success')} by {app.platform,os.type}`
        ),
        lines(
          'app.boot p75 (s) by app version',
          'p75:trace.Internal{service:web-app,env:$env.value,resource_name:app.boot} by {version}'
        ),
        lines(
          'navigation p75 (s) by app version',
          'p75:trace.Internal{service:web-app,env:$env.value,resource_name:navigation} by {version}'
        ),
      ]),
      graphGroup('Where the time goes', [
        toplist(
          'Slowest phases: p95 (ms) by phase and root',
          `top(p95:macro.web.phase.duration${scope()} by {resource_name,flow.root}${MS}, 25, 'mean', 'desc')`
        ),
        toplist(
          'Main-thread blocking: p95 long-animation-frame ms by flow',
          `top(p95:macro.web.flow.blocking_ms${scope()} by {resource_name}, 25, 'mean', 'desc')`
        ),
        lines(
          'Views p75 (ms) by OS',
          `p75:macro.web.view.duration${scope()} by {os.type}${MS}`
        ),
        lines(
          'Typing: p95 event duration (ms) by surface',
          `p95:macro.web.typing.event_duration_p95_ms${scope()} by {typing.surface}`
        ),
      ]),
      graphGroup('Runtime resources (visible tabs, ~60 s samples)', [
        lines(
          'JS heap used p50 / p95 (bytes) by platform',
          `p50:macro.web.runtime.js_heap_used_bytes${scope()} by {app.platform}, p95:macro.web.runtime.js_heap_used_bytes${scope()} by {app.platform}`
        ),
        lines(
          'Long-animation-frame blocking per sample p95 (ms) by platform',
          `p95:macro.web.runtime.blocking_ms${scope()} by {app.platform}`
        ),
      ]),
    ],
  }
);
