import {
  afterAll,
  beforeAll,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import * as childProcess from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as pulumi from '@pulumi/pulumi';
import type { RegisterResourceRequest } from '@pulumi/pulumi/proto/resource_pb';
import { MockMonitor } from '@pulumi/pulumi/runtime/mocks';

const resources: pulumi.runtime.MockResourceArgs[] = [];
const dependencies = new Map<string, string[]>();
const dist = mkdtempSync(join(tmpdir(), 'web-publication-'));
writeFileSync(join(dist, 'index.html'), '<html>fixture</html>');

beforeAll(async () => {
  // Staging commands must not run in a resource-graph test. The command
  // resources themselves use Pulumi's real constructors and mock monitor.
  mock.module('node:child_process', () => ({
    ...childProcess,
    execSync: mock(() => Buffer.from('')),
  }));
  const register = MockMonitor.prototype.registerResource;
  spyOn(MockMonitor.prototype, 'registerResource').mockImplementation(function (
    this: MockMonitor,
    request: RegisterResourceRequest,
    callback
  ) {
    dependencies.set(
      request.getName(),
      request.getDependenciesList().map((urn) => urn.split('::').at(-1) ?? urn)
    );
    return register.call(this, request, callback);
  });
  await pulumi.runtime.setMocks(
    {
      newResource(args) {
        resources.push(args);
        return {
          id: args.name,
          state: {
            ...args.inputs,
            arn: `arn:aws:test:us-east-1:123456789012:${args.name}`,
            bucket: args.inputs.bucket ?? args.name,
            websiteEndpoint: 'assets.example.test',
            version: '1',
            functionUrl: 'https://route.example.test/',
          },
        };
      },
      call(args) {
        return { ...args.inputs, partition: 'aws', dnsSuffix: 'amazonaws.com' };
      },
    },
    'macro-web-app',
    'dev',
    false
  );
  pulumi.runtime.setAllConfig({
    'macro-web-app:path': dist,
    'aws:region': 'us-east-1',
  });
  await import('./index');
  await pulumi.runtime.waitForRPCs();
});

afterAll(() => {
  mock.restore();
  rmSync(dist, { recursive: true, force: true });
});

function dependsOn(resource: string, predecessor: string): boolean {
  return (dependencies.get(resource) ?? []).some(
    (dependency) =>
      dependency === predecessor || dependsOn(dependency, predecessor)
  );
}

describe('web publication resource ordering', () => {
  test('the routing Lambda cannot publish HTML before the new assets', () => {
    expect(dependsOn('app-route-lambda', 'sync-assets-command')).toBe(true);
  });

  test('mutable entrypoints wait for both assets and the native archive', () => {
    expect(
      dependsOn('index-html-object-metadata-command', 'sync-assets-command')
    ).toBe(true);
    expect(dependsOn('index-html-object-metadata-command', 'app-archive')).toBe(
      true
    );
    expect(
      resources.find(
        (resource) => resource.name === 'index-html-object-metadata-command'
      )?.inputs.create
    ).toContain('publish-web-assets.sh entrypoints');
  });

  test('a failed HTML publication prevents pruning any retained build', () => {
    expect(dependsOn('retain-recent-builds-command', 'app-route-lambda')).toBe(
      true
    );
    expect(
      dependsOn(
        'retain-recent-builds-command',
        'index-html-object-metadata-command'
      )
    ).toBe(true);
  });

  test('the stable archive URL is not cached as an immutable asset', () => {
    expect(
      resources.find((resource) => resource.name === 'app-archive')?.inputs
        .cacheControl
    ).toBe('no-store');
  });
});
