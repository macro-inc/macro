import { beforeAll, expect, test } from 'bun:test';
import * as pulumi from '@pulumi/pulumi';

const resources: pulumi.runtime.MockResourceArgs[] = [];

beforeAll(async () => {
  pulumi.runtime.setAllConfig(
    { 'monitoring:goalertIntegrationKey': 'integration-key' },
    ['monitoring:goalertIntegrationKey']
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

test('every monitor and synthetic test notifies only the Macro Alerts channel and GoAlert', () => {
  const routed = [...monitors(), ...synthetics()];
  expect(routed.length).toBeGreaterThan(80);
  for (const resource of routed) {
    // Notification handles and email addresses; attribute names like `@error`
    // in message text are not handles.
    const handles: string[] =
      resource.inputs.message.match(
        /@(?:webhook|slack|pagerduty|opsgenie|teams)-[\w-]+|[\w.+-]+@[\w-]+\.[\w.]+/g
      ) ?? [];
    expect({ name: resource.name, handles }).toEqual({
      name: resource.name,
      handles: expect.arrayContaining(['@webhook-macro-alert-hook']),
    });
    for (const handle of handles) {
      expect([
        '@webhook-macro-alert-hook',
        '@webhook-goalert',
        '@webhook-goalert-close',
      ]).toContain(handle);
    }
  }
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

test('paging prod monitors open and close a GoAlert alert; the rest only notify', () => {
  const blocked = monitors().find(
    (r) => r.name === 'macrodb-blocked-connections'
  );
  expect(blocked?.inputs.message).toContain(
    '{{#is_alert}}Paging on-call. @webhook-goalert{{/is_alert}}'
  );
  expect(blocked?.inputs.message).toContain(
    '{{#is_recovery}}@webhook-goalert-close{{/is_recovery}}'
  );
  expect(blocked?.inputs.priority).toBe('2');

  // Grafana pages for this one, so Datadog only notifies.
  const freeable = monitors().find(
    (r) => r.name === 'macrodb-primary-freeable-memory'
  );
  expect(freeable?.inputs.message).not.toContain('@webhook-goalert');

  const latency = monitors().find((r) => r.name === 'macrodb-read-latency');
  expect(latency?.inputs.message).not.toContain('@webhook-goalert');
  expect(latency?.inputs.priority).toBe('3');
});

test('the GoAlert health check does not page through GoAlert', () => {
  const health = synthetics().find((r) => r.name === 'goalert-health');
  expect(health?.inputs.message).not.toContain('@webhook-goalert');
  expect(health?.inputs.requestDefinition.url).toBe(
    'https://oncall.macro-internal.com/health'
  );
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
