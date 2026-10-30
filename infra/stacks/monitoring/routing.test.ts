import { beforeAll, expect, test } from 'bun:test';
import * as pulumi from '@pulumi/pulumi';

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
  expect(prod).toHaveLength(25);
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
        (widget: { timeseriesDefinition: { title: string } }) =>
          widget.timeseriesDefinition.title === title
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
