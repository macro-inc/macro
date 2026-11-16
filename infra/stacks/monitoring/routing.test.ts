import { beforeAll, expect, test } from 'bun:test';
import * as pulumi from '@pulumi/pulumi';
import { evictStackModules } from './evict-stack-modules';

const resources: pulumi.runtime.MockResourceArgs[] = [];

beforeAll(async () => {
  pulumi.runtime.setAllConfig(
    {
      'monitoring:goalertIntegrationKey': 'integration-key',
      'monitoring:goalertNotifyIntegrationKey': 'notify-integration-key',
    },
    [
      'monitoring:goalertIntegrationKey',
      'monitoring:goalertNotifyIntegrationKey',
    ]
  );
  pulumi.runtime.setMocks(
    {
      newResource(args) {
        resources.push(args);
        // Datadog returns a dashboard's url as a path under the site.
        const state =
          args.type === 'datadog:index/dashboard:Dashboard'
            ? { ...args.inputs, url: `/dashboard/${args.name}/title` }
            : args.inputs;
        return { id: args.name, state };
      },
      call(args) {
        return args.inputs;
      },
    },
    'monitoring',
    'prod',
    false
  );
  evictStackModules();
  await import('./index');
  await pulumi.runtime.waitForRPCs();
});

const monitors = () =>
  resources.filter((r) => r.type === 'datadog:index/monitor:Monitor');
const dashboards = () =>
  resources.filter((r) => r.type === 'datadog:index/dashboard:Dashboard');
const synthetics = () =>
  resources.filter(
    (r) => r.type === 'datadog:index/syntheticsTest:SyntheticsTest'
  );

// Notification handles and email addresses; attribute names like `@error` in
// message text are not handles.
const handles = (message: string): string[] =>
  message.match(
    /@(?:webhook|slack|pagerduty|opsgenie|teams)-[\w-]+|[\w.+-]+@[\w-]+\.[\w.]+/g
  ) ?? [];

// Dev and staging monitors stay in Datadog but notify no one.
const nonProd = (r: pulumi.runtime.MockResourceArgs) =>
  /\[(DEV|STAGING)\]/.test(r.inputs.name);

test('dev and staging monitors notify no one', () => {
  const quiet = monitors().filter(nonProd);
  expect(quiet.length).toBeGreaterThan(5);
  for (const resource of quiet) {
    expect({
      name: resource.name,
      handles: handles(resource.inputs.message),
    }).toEqual({ name: resource.name, handles: [] });
  }
});

test('every prod monitor and synthetic test notifies only GoAlert', () => {
  const routed = [...monitors(), ...synthetics()].filter(
    (r) => r.name !== 'goalert-health' && !nonProd(r)
  );
  expect(routed.length).toBeGreaterThan(80);
  for (const resource of routed) {
    const found = handles(resource.inputs.message);
    expect({ name: resource.name, handles: found }).toEqual({
      name: resource.name,
      handles: expect.arrayContaining([
        '@webhook-goalert-notify',
        '@webhook-goalert-notify-close',
      ]),
    });
    for (const handle of found) {
      expect([
        '@webhook-goalert',
        '@webhook-goalert-close',
        '@webhook-goalert-notify',
        '@webhook-goalert-notify-close',
      ]).toContain(handle);
    }
  }
});

test('only the GoAlert health check posts to the channel directly', () => {
  const health = synthetics().find((r) => r.name === 'goalert-health');
  expect(handles(health?.inputs.message)).toEqual([
    '@webhook-macro-alert-hook',
  ]);
  expect(health?.inputs.requestDefinition.url).toBe(
    'https://oncall.macro-internal.com/health'
  );
});

test('every monitor renotifies while it stays in alert', () => {
  for (const resource of monitors()) {
    expect({
      name: resource.name,
      renotify: resource.inputs.renotifyInterval,
    }).toEqual({
      name: resource.name,
      renotify: 60,
    });
  }
  for (const resource of synthetics()) {
    expect(resource.inputs.optionsList.monitorOptions.renotifyInterval).toBe(
      60
    );
  }
});

test('a paging monitor pages on critical and notifies otherwise', () => {
  const blocked = monitors().find(
    (r) => r.name === 'macrodb-blocked-connections'
  );
  expect(blocked?.inputs.message).toEndWith(
    '{{#is_alert}}Paging on-call. @webhook-goalert{{/is_alert}}{{#is_warning}}@webhook-goalert-notify{{/is_warning}}{{#is_no_data}}@webhook-goalert-notify{{/is_no_data}}{{#is_recovery}}@webhook-goalert-close @webhook-goalert-notify-close{{/is_recovery}}'
  );
  expect(blocked?.inputs.priority).toBe('2');
});

test('a non-paging monitor notifies on every state', () => {
  // Grafana pages for this one, so Datadog only notifies.
  const freeable = monitors().find(
    (r) => r.name === 'macrodb-primary-freeable-memory'
  );
  expect(freeable?.inputs.message).toEndWith(
    '{{#is_alert}}@webhook-goalert-notify{{/is_alert}}{{#is_warning}}@webhook-goalert-notify{{/is_warning}}{{#is_no_data}}@webhook-goalert-notify{{/is_no_data}}{{#is_recovery}}@webhook-goalert-notify-close{{/is_recovery}}'
  );
  expect(freeable?.inputs.priority).toBe('3');
});

test('anomaly rules recover at zero and carry their alert window', () => {
  const anomaly = monitors().find((r) => r.name === 'apm-server-error-anomaly');
  expect(anomaly?.inputs.monitorThresholds).toEqual({
    critical: '1',
    criticalRecovery: '0',
  });
  expect(anomaly?.inputs.monitorThresholdWindows).toEqual({
    triggerWindow: 'last_30m',
    recoveryWindow: 'last_15m',
  });
});

test('a prod monitor links to its dashboard', () => {
  const cpu = monitors().find((r) => r.name === 'macrodb-cpu');
  expect(cpu?.inputs.message).toContain(
    'Runbook: https://github.com/macro-inc/macro/blob/main/docs/runbooks/macrodb.md#load\nDashboard: https://us5.datadoghq.com/dashboard/macrodb-alerts/title'
  );
});

test('every prod monitor is graphed on its dashboard with its thresholds', () => {
  const prod = monitors().filter((r) =>
    r.inputs.message.includes('Runbook: https://github.com/macro-inc/macro/')
  );
  expect(prod.map((monitor) => monitor.name).sort()).toEqual([
    'agent-harness-runtime-starvation',
    'agent-harness-task-memory',
    'agent-runtime-reattach-dials',
    'agent-runtime-reattach-sessions',
    'ai-editing-provider-account-unavailable',
    'ai-fireworks-spend-nearing-cap',
    'ai-fireworks-spend-reached-cap',
    'ai-provider-account-unavailable',
    'apm-consumer-error-anomaly',
    'apm-internal-error-anomaly',
    'apm-latency-anomaly',
    'apm-server-error-anomaly',
    'computer-fleet-capacity',
    'computer-host-capacity',
    'error-logs-anomaly',
    'macrodb-blocked-connections',
    'macrodb-cpu',
    'macrodb-free-storage',
    'macrodb-free-storage-forecast',
    'macrodb-io-credits',
    'macrodb-load',
    'macrodb-long-transactions',
    'macrodb-primary-connections',
    'macrodb-primary-freeable-memory',
    'macrodb-read-latency',
    'macrodb-replica-connections',
    'macrodb-replica-freeable-memory',
    'macrodb-replica-lag',
    'macrodb-swap',
    'outlook-graph-throttling',
    'outlook-mailbox-stalled',
    'outlook-message-parked-too-long',
    'outlook-persistence-errors',
    'outlook-reauthorization-spike',
    'outlook-token-failures',
    'redis-evictions',
    'redis-memory',
    'redis-memory-forecast',
    'routine-suggestions-failures',
    'sqs-dlq-inflow',
    'sqs-email-backfill-age',
    'sqs-email-backfill-backlog-anomaly',
    'sqs-work-queue-age',
    'storage-pool-wait',
  ]);
  for (const monitor of prod) {
    const linked = monitor.inputs.message.match(
      /Dashboard: https:\/\/us5\.datadoghq\.com\/dashboard\/([\w-]+)\//
    )?.[1];
    const dashboard = dashboards().find((d) => d.name === linked);
    const title = monitor.inputs.name.replace('[PROD] ', '');
    const graph = dashboard?.inputs.widgets
      .flatMap(
        (group: { groupDefinition: { widgets: unknown[] } }) =>
          group.groupDefinition.widgets
      )
      .find(
        (widget: { timeseriesDefinition?: { title: string } }) =>
          widget.timeseriesDefinition?.title === title
      );
    const { critical, warning } = monitor.inputs.monitorThresholds;
    const anomaly = monitor.inputs.query.includes('anomalies(');
    expect({
      name: monitor.name,
      markers: graph?.timeseriesDefinition.markers.map(
        (marker: { value: string }) => marker.value
      ),
    }).toEqual({
      name: monitor.name,
      markers: anomaly
        ? []
        : [`y = ${critical}`, ...(warning ? [`y = ${warning}`] : [])],
    });
  }
});

test('routine suggestion failures notify over an hour, above a floor', () => {
  const failures = monitors().find(
    (r) => r.name === 'routine-suggestions-failures'
  );
  expect(failures?.inputs.query).toBe(
    'sum(last_1h):sum:macro.routine_suggestions.generation{env:prod,outcome:failed}.as_count() / (sum:macro.routine_suggestions.generation{env:prod,!outcome:cancelled}.as_count() + 20) > 0.1'
  );
  expect(failures?.inputs.priority).toBe('3');
  expect(failures?.inputs.message).not.toContain('@webhook-goalert ');
});

test('instance I/O credits alert per instance, well before they run out', () => {
  const credits = monitors().find((r) => r.name === 'macrodb-io-credits');
  expect(credits?.inputs.query).toBe(
    'avg(last_15m):min:aws.rds.ebsiobalance{dbinstanceidentifier:macro-db-prod*} by {dbinstanceidentifier} < 40'
  );
  expect(credits?.inputs.monitorThresholds).toEqual({
    critical: '40',
    warning: '70',
  });
  expect(credits?.inputs.message).toContain('{{dbinstanceidentifier.name}}');
  expect(credits?.inputs.message).toContain('macrodb.md#io-credits');
});

test('pool waits alert names the environment and the pool', () => {
  const wait = monitors().find((r) => r.name === 'storage-pool-wait');
  expect(wait?.inputs.name).toStartWith('[PROD] ');
  expect(wait?.inputs.query).toBe(
    'avg(last_10m):default_zero(max:db.client.connection.wait_time{env:prod,service:cloud-storage-service} by {db.client.connection.pool.name}) > 5'
  );
  expect(wait?.inputs.onMissingData).toBe('default');
  expect(wait?.inputs.message).toContain(
    '{{[db.client.connection.pool.name].name}}'
  );
  expect(wait?.inputs.message).toContain('macrodb.md#pool-waits');
  expect(wait?.inputs.message).toContain(
    'Dashboard: https://us5.datadoghq.com/dashboard/storage-pool-saturation/title'
  );
});

test('pool graphs never sum or take percentiles across tasks', () => {
  const dashboard = dashboards().find(
    (d) => d.name === 'storage-pool-saturation'
  );
  const queries: string[] = dashboard?.inputs.widgets
    .flatMap(
      (group: { groupDefinition: { widgets: unknown[] } }) =>
        group.groupDefinition.widgets
    )
    .flatMap(
      (widget: { timeseriesDefinition?: { requests: { q?: string }[] } }) =>
        widget.timeseriesDefinition?.requests.map((request) => request.q) ?? []
    )
    .filter((q: string | undefined) => q?.includes('db.client.connection'));
  expect(queries.length).toBeGreaterThan(4);
  for (const q of queries) {
    expect(q).not.toMatch(/(sum|avg|p\d+):db\.client\.connection/);
  }
  expect(queries.join()).toContain(
    'max:db.client.connection.used{env:$env.value,service:cloud-storage-service} by {db.client.connection.pool.name,availability-zone}, max:db.client.connection.max{'
  );
});
