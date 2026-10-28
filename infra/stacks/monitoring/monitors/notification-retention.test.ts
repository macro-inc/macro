import { beforeAll, expect, test } from 'bun:test';
import * as pulumi from '@pulumi/pulumi';

const resources: pulumi.runtime.MockResourceArgs[] = [];

beforeAll(async () => {
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
  await import('./notification-retention');
  await pulumi.runtime.waitForRPCs();
});

function monitor(name: string): pulumi.runtime.MockResourceArgs {
  const value = resources.find((r) => r.name === name);
  if (!value) throw new Error(`Missing monitor ${name}`);
  return value;
}

test('backlog and stale-health alerts isolate each consumer and retire old instances', () => {
  for (const env of ['dev', 'prod']) {
    for (const kind of ['backlog', 'health']) {
      const inputs = monitor(`notification-consumer-${kind}-${env}`).inputs;
      expect(inputs.query).toContain(`env:${env}`);
      expect(inputs.query).toContain('.by("@consumer_instance")');
      expect(inputs.onMissingData).toBe('resolve');
    }
    const backlog = monitor(`notification-consumer-backlog-${env}`).inputs;
    expect(backlog.query).toContain('@consumer_health:healthy');
    expect(backlog.query).toContain('@max_offset_backlog');
    expect(backlog.query).not.toContain('committed');
    const health = monitor(`notification-consumer-health-${env}`).inputs;
    expect(health.query).toContain('stale OR unavailable OR disconnected');
    expect(health.query).not.toContain('starting');
  }
});

test('missing telemetry is an alarm, not a healthy zero backlog', () => {
  for (const env of ['dev', 'prod']) {
    const inputs = monitor(`notification-consumer-heartbeat-${env}`).inputs;
    expect(inputs.query).toContain('.last("5m") < 1');
    expect(inputs.query).not.toContain('.by(');
    expect(inputs.onMissingData).toBe('default');
  }
});

test('trace flush and realtime publication failures are covered separately from Lambda errors', () => {
  expect(
    monitor('notification-retention-telemetry-export').inputs.query
  ).toContain('notification retention telemetry flush');
  for (const env of ['dev', 'prod']) {
    expect(
      monitor(`notification-delete-publication-${env}`).inputs.query
    ).toContain('failed to publish notification delete realtime update');
  }
});

test('dashboard charts only known backlog alongside health and deletion progress', () => {
  const dashboard = monitor('notification-retention').inputs;
  const query = dashboard.widgets[0].timeseriesDefinition.requests[0].logQuery;
  expect(query.searchQuery).toContain('@consumer_health:healthy');
  expect(query.computeQuery.facet).toBe('@max_offset_backlog');
  expect(dashboard.widgets).toHaveLength(4);
  expect(
    resources.filter((r) => r.type.includes('monitor:Monitor'))
  ).toHaveLength(9);
});
