import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as pulumi from '@pulumi/pulumi';

const resources: pulumi.runtime.MockResourceArgs[] = [];

beforeAll(async () => {
  mock.module('node:child_process', () => ({
    ...childProcess,
    execSync: mock(() => Buffer.from('')),
  }));
  const readFileSync = fs.readFileSync;
  mock.module('fs', () => ({
    ...fs,
    readFileSync: (...args: Parameters<typeof readFileSync>) =>
      args[0] === './wwwRedirect/handler.js'
        ? 'function handler(event) { return event.request; }'
        : Reflect.apply(readFileSync, fs, args),
  }));
  mock.module('../../packages/utils', () => ({ hasItems: () => true }));
  await pulumi.runtime.setMocks(
    {
      newResource(args) {
        resources.push(args);
        return {
          id: args.name,
          state: {
            ...args.inputs,
            arn: `arn:aws:test:us-east-1:123456789012:${args.name}`,
            bucket: args.name,
            websiteEndpoint: 'site.example.test',
            domainName: 'cdn.example.test',
            hostedZoneId: 'zone-id',
            outputs: {
              macroWebAppBucketArn: 'arn:aws:s3:::web-app-test',
              macroWebAppBucketWebsiteEndpoint: 'assets.example.test',
              appRouteLambdaId: 'route-lambda',
              appRouteUrl: 'https://route.example.test/',
            },
          },
        };
      },
      call(args) {
        return {
          ...args.inputs,
          id: 'test-id',
          arn: 'arn:aws:test',
          zoneId: 'test-zone',
        };
      },
    },
    'website-infra',
    'dev',
    false
  );
  pulumi.runtime.setAllConfig({
    'aws:region': 'us-east-1',
    'website-infra:certArn':
      'arn:aws:acm:us-east-1:123456789012:certificate/test',
    'website-infra:domain': 'example.test',
    'website-infra:subdomain': 'dev',
    'website-infra:oidcBucketArn': 'arn:aws:s3:::oidc-test',
    'website-infra:oidcBucketWebsiteEndpoint': 'oidc.example.test',
  });
  await import('./index');
  await pulumi.runtime.waitForRPCs();
});

afterAll(() => mock.restore());

function resource(resourceName: string): pulumi.runtime.MockResourceArgs {
  const result = resources.find((entry) => entry.name === resourceName);
  if (!result) throw new Error(`Missing resource ${resourceName}`);
  return result;
}

describe('app asset caching', () => {
  test('missing asset responses default to no-store without overriding successful object metadata', () => {
    const policy = resource('website-infra-app-asset-headers-dev').inputs;
    expect(policy.customHeadersConfig.items).toContainEqual({
      header: 'Cache-Control',
      value: 'no-store',
      override: false,
    });
    expect(policy.customHeadersConfig.items).toContainEqual({
      header: 'Cross-Origin-Opener-Policy',
      value: 'same-origin-allow-popups',
      override: true,
    });
  });

  test('the static app behavior actually uses safe viewer and edge policies', () => {
    const distribution = resource('cdn-dev').inputs;
    const assets = distribution.orderedCacheBehaviors.find(
      (behavior: { pathPattern: string }) => behavior.pathPattern === '/app/*.*'
    );
    expect(assets.responseHeadersPolicyId).toBe(
      'website-infra-app-asset-headers-dev'
    );
    expect(assets.cachePolicyId).toBe('website-infra-app-asset-cache-dev');
    expect(resource('website-infra-app-asset-cache-dev').inputs).toMatchObject({
      minTtl: 0,
      defaultTtl: 0,
      maxTtl: 31536000,
    });
  });

  test('transient asset failures are not retained as edge errors after publication', () => {
    expect(resource('cdn-dev').inputs.customErrorResponses).toEqual(
      [403, 404, 500, 502, 503, 504].map((errorCode) => ({
        errorCode,
        errorCachingMinTtl: 0,
      }))
    );
  });
});
