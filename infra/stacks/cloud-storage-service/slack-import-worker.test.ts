import { beforeAll, describe, expect, mock, test } from 'bun:test';
import * as pulumi from '@pulumi/pulumi';
import servicesConfig from '../../../.github/services-config.json';

const resources: pulumi.runtime.MockResourceArgs[] = [];
const calls: pulumi.runtime.MockCallArgs[] = [];
const secretArn =
  'arn:aws:secretsmanager:us-east-1:123456789012:secret:doppler';

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
            url: 'example.invalid/worker',
            imageUri: 'example.invalid/worker:latest',
            repository: { id: args.name },
            service: { name: args.name, arn: 'arn:aws:ecs:service/worker' },
          },
        };
      },
      call(args) {
        calls.push(args);
        return { ...args.inputs, arn: secretArn, secretString: 'test-only' };
      },
    },
    'slack-import-tests',
    'dev',
    false
  );
  // Isolate the shared barrel's ESM cycle, keeping the real Doppler/image helpers.
  mock.module('../../packages/shared', () => ({
    stack: 'dev',
    CLOUD_TRAIL_SNS_TOPIC_ARN: 'arn:aws:sns:us-east-1:123456789012:alerts',
  }));
  const { SlackImportWorker } = await import('./slack-import-worker');
  new SlackImportWorker('slack-import-worker-dev', {
    ecsClusterArn: 'cluster',
    vpc: { vpcId: 'vpc', privateSubnetIds: ['private-subnet'] },
    workerPolicyArn: 'scoped-worker-policy',
    stagingBucketName: 'bulk-upload-staging-dev',
    queueName: 'slack-import-queue-dev',
    dlqName: 'slack-import-dlq-dev',
    gatewayUrl: 'https://dev-gateway.macro.com/connection-gateway',
    searchProcessingUrl: 'https://dev-gateway.macro.com/search-processing',
    tags: {},
  });
  await pulumi.runtime.waitForRPCs();
});

function resource(type: string): pulumi.runtime.MockResourceArgs {
  const result = resources.find((item) => item.type === type);
  if (!result) throw new Error(`Missing resource ${type}`);
  return result;
}

describe('Slack import Fargate worker', () => {
  test('CI builds the worker and detects import changes in the owning stack', () => {
    const service = servicesConfig.services['document-storage-service'];
    expect(service.stack_path).toBe('infra/stacks/cloud-storage-service/**');
    expect(service.deploy_binaries).toContain('slack_import_worker');
    for (const path of [
      'services/slack_import_worker/**',
      'crates/slack_integration/**',
      'crates/channels/**',
      'crates/messages/**',
      'crates/import/**',
      'crates/macro_queues/**',
      'crates/macro_service_urls/**',
    ]) {
      expect(service.source_paths).toContain(path);
    }
  });

  test('independent no-port service has bounded resources including sidecars', () => {
    const service = resource('awsx:ecs:FargateService').inputs;
    expect(service.desiredCount).toBe(1);
    expect(service.loadBalancers).toBeUndefined();
    expect(service.networkConfiguration).toEqual({
      subnets: ['private-subnet'],
      securityGroups: ['slack-import-worker-dev-sg'],
      assignPublicIp: false,
    });
    const task = service.taskDefinitionArgs;
    expect(task.cpu).toBe('1024');
    expect(task.memory).toBe('2048');
    expect(task.containers.worker.stopTimeout).toBe(120);
    expect(task.containers.worker.memory).toBe(1536);
    let memory = 0;
    for (const container of Object.values(task.containers) as {
      memory: number;
      memoryReservation?: number;
      portMappings?: unknown[];
    }[]) {
      memory += container.memory;
      expect(container.memoryReservation ?? 0).toBeLessThanOrEqual(
        container.memory
      );
      expect(container.portMappings ?? []).toEqual([]);
    }
    expect(memory).toBe(2048);
    expect(service.deploymentCircuitBreaker).toEqual({
      enable: true,
      rollback: true,
    });
  });

  test('dedicated task role only receives the scoped import policy, with no ingress', () => {
    expect(
      resource('aws:iam/rolePolicyAttachment:RolePolicyAttachment').inputs
    ).toMatchObject({
      role: 'slack-import-worker-dev-role',
      policyArn: 'scoped-worker-policy',
    });
    const sg = resource('aws:ec2/securityGroup:SecurityGroup').inputs;
    expect(sg.ingress ?? []).toEqual([]);
    expect(
      resources.some((item) =>
        /IngressRule|TargetGroup|ListenerRule/.test(item.type)
      )
    ).toBe(false);
    expect(
      resource('aws:vpc/securityGroupEgressRule:SecurityGroupEgressRule').inputs
    ).toMatchObject({
      cidrIpv4: '0.0.0.0/0',
      ipProtocol: '-1',
    });
  });

  test('uses the worker binary and its own Doppler sync, not the DSS image/config', () => {
    expect(resource('awsx:ecr:Image').inputs.args).toEqual({
      SERVICE_NAME: 'slack_import_worker',
    });
    expect(resource('awsx:ecr:Repository').inputs.name).toBe(
      'slack-import-worker-dev'
    );
    const task = resource('awsx:ecs:FargateService').inputs.taskDefinitionArgs;
    expect(task.taskRole.roleArn).not.toBe(task.executionRole.roleArn);
    expect(task.containers.worker.secrets).toEqual(
      [
        'DATABASE_URL',
        'INTERNAL_API_KEY',
        'SLACK_IMPORT_ENABLED',
        'SLACK_IMPORT_CONCURRENCY',
      ].map((key) => ({
        name: key,
        valueFrom: `${secretArn}:${key}::`,
      }))
    );
    expect(
      resources.some(
        (item) => item.name === 'slack-import-worker-execution-role'
      )
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.inputs.secretId ===
          '/doppler-sync/slack-import-worker/dev/doppler'
      )
    ).toBe(true);
  });

  test('wires queue names, staging and the processing API rather than search queries', () => {
    const worker = resource('awsx:ecs:FargateService').inputs.taskDefinitionArgs
      .containers.worker;
    const env = Object.fromEntries(
      worker.environment.map((entry: { name: string; value: string }) => [
        entry.name,
        entry.value,
      ])
    );
    expect(env).toMatchObject({
      ENVIRONMENT: 'dev',
      UPLOAD_STAGING_BUCKET: 'bulk-upload-staging-dev',
      OVERRIDE_SLACK_IMPORT_QUEUE: 'slack-import-queue-dev',
      OVERRIDE_SLACK_IMPORT_DLQ: 'slack-import-dlq-dev',
      OVERRIDE_CONNECTION_GATEWAY_URL:
        'https://dev-gateway.macro.com/connection-gateway',
      OVERRIDE_SEARCH_PROCESSING_SERVICE_URL:
        'https://dev-gateway.macro.com/search-processing',
    });
    expect(env.SEARCH_SERVICE_URL).toBeUndefined();
    expect(env.OVERRIDE_SEARCH_SERVICE_URL).toBeUndefined();
  });
});
