import { beforeAll, describe, expect, mock, test } from 'bun:test';
import * as pulumi from '@pulumi/pulumi';

const resources: pulumi.runtime.MockResourceArgs[] = [];
const bucketArn = 'arn:aws:s3:::bulk-upload-staging-dev';
const mainArn = 'arn:aws:sqs:us-east-1:123456789012:slack-import-queue-dev';
const dlqArn = 'arn:aws:sqs:us-east-1:123456789012:slack-import-dlq-dev';

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
            arn: `arn:aws:sqs:us-east-1:123456789012:${args.inputs.name ?? args.name}`,
          },
        };
      },
      call(args) {
        return { ...args.inputs, secretString: 'test-only' };
      },
    },
    'slack-import-tests',
    'dev',
    false
  );
  // Avoid the shared barrel's pre-existing ESM cycle, not the Queue component.
  mock.module('../../packages/shared', () => ({
    stack: 'dev',
    CLOUD_TRAIL_SNS_TOPIC_ARN: 'arn:aws:sns:us-east-1:123456789012:alerts',
  }));
  const { SlackImportQueue } = await import('./slack-import-queue');
  new SlackImportQueue('slack-import-dev', {
    stagingBucketArn: bucketArn,
    tags: {},
  });
  await pulumi.runtime.waitForRPCs();
});

function resource(type: string, name: string): pulumi.runtime.MockResourceArgs {
  const result = resources.find(
    (item) => item.type === type && item.name === name
  );
  if (!result) throw new Error(`Missing resource ${type} ${name}`);
  return result;
}

describe('Slack import queue and IAM', () => {
  test('shared Queue creates the actual typed main/DLQ names, redrive and alarm', () => {
    const main = resource(
      'aws:sqs/queue:Queue',
      'slack-import-queue-dev'
    ).inputs;
    const dlq = resource('aws:sqs/queue:Queue', 'slack-import-dlq-dev').inputs;
    expect(main.name).toBe('slack-import-queue-dev');
    expect(main.visibilityTimeoutSeconds).toBe(900);
    expect(main.fifoQueue).toBe(false);
    expect(JSON.parse(main.redrivePolicy)).toEqual({
      deadLetterTargetArn: dlqArn,
      maxReceiveCount: 5,
    });
    expect(dlq.name).toBe('slack-import-dlq-dev');
    expect(dlq.messageRetentionSeconds).toBe(14 * 24 * 60 * 60);
    expect(
      resources.filter((item) => item.type === 'aws:sqs/queue:Queue')
    ).toHaveLength(2);
    expect(
      resource(
        'aws:cloudwatch/metricAlarm:MetricAlarm',
        'slack-import-dlq-alarm'
      ).inputs.dimensions
    ).toEqual({
      QueueName: dlq.name,
    });
  });

  test('DSS can only put and verify Slack staging objects, not operate the queue', () => {
    const policy = resource(
      'aws:iam/policy:Policy',
      'slack-import-dev-upload-policy'
    ).inputs.policy;
    expect(policy).toEqual({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['s3:PutObject', 's3:GetObject'],
          Resource: [`${bucketArn}/slack-import/*`],
        },
      ],
    });
  });

  test('worker can read staging, reconcile both queues and publish only to main', () => {
    const policy = resource(
      'aws:iam/policy:Policy',
      'slack-import-dev-worker-policy'
    ).inputs.policy;
    expect(policy).toEqual({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['s3:GetObject'],
          Resource: [`${bucketArn}/slack-import/*`],
        },
        {
          Effect: 'Allow',
          Action: [
            'sqs:GetQueueUrl',
            'sqs:ReceiveMessage',
            'sqs:DeleteMessage',
            'sqs:ChangeMessageVisibility',
          ],
          Resource: [mainArn, dlqArn],
        },
        {
          Effect: 'Allow',
          Action: ['sqs:SendMessage'],
          Resource: [mainArn],
        },
      ],
    });
    expect(JSON.stringify(policy)).not.toContain('sqs:*');
    expect(JSON.stringify(policy)).not.toContain('s3:HeadObject');
  });
});
