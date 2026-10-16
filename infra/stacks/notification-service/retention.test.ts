import { beforeAll, expect, mock, test } from 'bun:test';
import * as pulumi from '@pulumi/pulumi';

const resources: pulumi.runtime.MockResourceArgs[] = [];
const secretArn =
  'arn:aws:secretsmanager:us-east-1:123456789012:secret:datadog-test';

beforeAll(async () => {
  pulumi.runtime.setAllConfig({ 'aws:region': 'us-east-1' });
  pulumi.runtime.setMocks(
    {
      newResource(args) {
        resources.push(args);
        return {
          id: args.name,
          state: {
            ...args.inputs,
            name: args.inputs.name ?? args.name,
            arn: `arn:aws:mock:us-east-1:123456789012:${args.name}`,
          },
        };
      },
      call(args) {
        return args.inputs;
      },
    },
    'notification-service',
    'dev',
    false
  );
  mock.module('../../packages/shared', () => ({
    stack: 'dev',
    CLOUD_TRAIL_SNS_TOPIC_ARN: 'arn:aws:sns:us-east-1:123456789012:alerts',
    CLOUDWATCH_KINESIS_STREAM_ROLE_ARN: 'arn:aws:iam::123456789012:role/logs',
    DATADOG_KINESIS_FIREHOSE_STREAM_ARN:
      'arn:aws:firehose:us-east-1:123456789012:logs',
  }));
  mock.module('../../packages/resources', () => ({
    DATADOG_API_KEY_SECRET_ARN: pulumi.output(secretArn),
  }));
  // Keep the real Lambda resources, but don't depend on the test runner's cwd.
  mock.module('../../packages/lambda/src/hash', () => ({
    generateContentHash: () => 'test-source-hash',
  }));
  // Pulumi dynamic-provider closure serialization is Node-only; it is unrelated
  // to the AWS configuration under test.
  mock.module('../../packages/lambda/src/source_code_hash', () => ({
    SourceCodeHash: class extends pulumi.ComponentResource {
      constructor(
        name: string,
        args: { sourceCodeHash: string },
        opts?: pulumi.ComponentResourceOptions
      ) {
        super('test:source:Hash', name, args, opts);
      }
    },
  }));
  const { NotificationRetention } = await import('./retention');
  new NotificationRetention('retention-test', {
    databaseUrl: pulumi.secret('test-database'),
    enabled: false,
    dryRun: true,
    vpc: {
      vpcId: 'vpc-test',
      publicSubnetIds: [],
      privateSubnetIds: ['subnet-test'],
    },
    tags: {},
  });
  await pulumi.runtime.waitForRPCs();
});

function resource(type: string): pulumi.runtime.MockResourceArgs {
  const value = resources.find((r) => r.type === type);
  if (!value) throw new Error(`Missing ${type}`);
  return value;
}

test('retention has a pinned OTLP collector and consistent service identity', () => {
  const fn = resource('aws:lambda/function:Function').inputs;
  expect(fn.layers).toEqual([
    'arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:101',
  ]);
  const environment = pulumi.runtime.unwrapRpcSecret(fn.environment);
  expect(environment.variables).toMatchObject({
    DD_SERVICE: 'notification-retention',
    DD_ENV: 'dev',
    DD_SITE: 'us5.datadoghq.com',
    DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_GRPC_ENDPOINT: '127.0.0.1:4317',
    DD_SERVERLESS_LOGS_ENABLED: 'false',
    DD_API_KEY_SECRET_ARN: secretArn,
  });
  expect(environment.variables.DD_API_KEY).toBeUndefined();
  expect(fn.reservedConcurrentExecutions).toBe(1);
});

test('extension access is scoped to the existing Datadog key, not all secrets', () => {
  const policy = JSON.parse(
    resource('aws:iam/rolePolicy:RolePolicy').inputs.policy
  );
  expect(policy.Statement).toEqual([
    {
      Effect: 'Allow',
      Action: 'secretsmanager:GetSecretValue',
      Resource: secretArn,
    },
  ]);
});

test('telemetry does not enable cleanup or duplicate the existing log path', () => {
  expect(resource('aws:cloudwatch/eventRule:EventRule').inputs.state).toBe(
    'DISABLED'
  );
  expect(
    JSON.parse(resource('aws:cloudwatch/eventTarget:EventTarget').inputs.input)
  ).toEqual({ dry_run: true });
  expect(
    resource('aws:cloudwatch/logSubscriptionFilter:LogSubscriptionFilter')
      .inputs.destinationArn
  ).toBe('arn:aws:firehose:us-east-1:123456789012:logs');
});
