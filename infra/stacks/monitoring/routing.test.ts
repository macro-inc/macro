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
        return { id: args.name, state: args.inputs };
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
