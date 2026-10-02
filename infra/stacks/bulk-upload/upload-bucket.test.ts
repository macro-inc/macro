import { beforeAll, describe, expect, mock, test } from 'bun:test';
import * as pulumi from '@pulumi/pulumi';

const resources: pulumi.runtime.MockResourceArgs[] = [];
const bucketArn = 'arn:aws:s3:::bulk-upload-staging-dev';
const roleArn = 'arn:aws:iam::123456789012:role/cloud-storage-service-role-dev';

beforeAll(async () => {
  pulumi.runtime.setAllConfig({ 'aws:region': 'us-east-1' });
  pulumi.runtime.setMocks(
    {
      newResource(args) {
        resources.push(args);
        return {
          id: args.inputs.bucket ?? args.name,
          state: { ...args.inputs, arn: bucketArn },
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
  // The shared barrel has a pre-existing ESM cycle; isolate stack constants
  // while exercising the real bucket helper and AWS resource constructors.
  mock.module('../../packages/shared', () => ({
    stack: 'dev',
    CLOUD_TRAIL_SNS_TOPIC_ARN: 'arn:aws:sns:us-east-1:123456789012:alerts',
  }));
  const { BulkUploadBucket } = await import('./upload-bucket');
  new BulkUploadBucket('bulk-upload-bucket', {
    cloudStorageServiceRoleArn: roleArn,
    tags: {},
  });
  await pulumi.runtime.waitForRPCs();
});

function resource(type: string): pulumi.runtime.MockResourceArgs {
  const matches = resources.filter((item) => item.type === type);
  expect(matches).toHaveLength(1);
  return matches[0];
}

describe('Slack import staging protections', () => {
  test('one helper-owned lifecycle rule expires only the Slack prefix after 14 days', () => {
    const lifecycle = resource(
      'aws:s3/bucketLifecycleConfigurationV2:BucketLifecycleConfigurationV2'
    );
    expect(lifecycle.name).toBe('bulk-upload-bucket-lifecycle');
    expect(lifecycle.inputs.rules).toEqual([
      {
        id: 'slack-import-cleanup',
        status: 'Enabled',
        filter: { prefix: 'slack-import/' },
        expiration: { days: 14 },
      },
    ]);
  });

  test('one existing CORS owner permits conditional checksum PUTs and legacy requests', () => {
    const cors = resource(
      'aws:s3/bucketCorsConfigurationV2:BucketCorsConfigurationV2'
    );
    expect(cors.name).toBe('bulk-upload-bucket-cors');
    expect(cors.inputs.corsRules).toHaveLength(1);
    const rule = cors.inputs.corsRules[0];
    // Wildcard covers Content-Type, If-None-Match and x-amz-checksum-sha256.
    expect(rule.allowedHeaders).toEqual(['*']);
    expect(rule.allowedMethods).toEqual([
      'GET',
      'PUT',
      'POST',
      'DELETE',
      'HEAD',
    ]);
    expect(rule.allowedOrigins).toContain('https://macro.com');
    expect(rule.allowedOrigins).toContain('http://localhost:3000');
    expect(rule.allowedOrigins).not.toContain('*');
    expect(rule.exposeHeaders).toContain('ETag');
  });

  test('conditional write deny is prefix-only and legacy bucket access is unchanged', () => {
    const policy = JSON.parse(
      resource('aws:s3/bucketPolicy:BucketPolicy').inputs.policy
    );
    expect(policy).toEqual({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: roleArn },
          Action: [
            's3:GetObject',
            's3:PutObject',
            's3:GetObjectAttributes',
            's3:ListBucket',
          ],
          Resource: [bucketArn, `${bucketArn}/*`],
        },
        {
          Sid: 'RequireImmutableSlackImports',
          Effect: 'Deny',
          Principal: '*',
          Action: ['s3:PutObject'],
          Resource: [`${bucketArn}/slack-import/*`],
          Condition: { StringNotEquals: { 's3:if-none-match': '*' } },
        },
      ],
    });
    expect(JSON.stringify(policy)).not.toContain('s3:HeadObject');
  });

  test('existing EventBridge notification remains the sole notification resource', () => {
    const notification = resource(
      'aws:s3/bucketNotification:BucketNotification'
    );
    expect(notification.name).toBe('bulk-upload-staging-dev-notification');
    expect(notification.inputs).toEqual({
      bucket: 'bulk-upload-staging-dev',
      eventbridge: true,
    });
    expect(resource('aws:s3/bucketObjectv2:BucketObjectv2').inputs.key).toBe(
      'extract/'
    );
    const access = resource(
      'aws:s3/bucketPublicAccessBlock:BucketPublicAccessBlock'
    ).inputs;
    expect(access.blockPublicAcls).toBe(true);
    expect(access.blockPublicPolicy).toBe(true);
    expect(access.ignorePublicAcls).toBe(true);
    expect(access.restrictPublicBuckets).toBe(true);
  });
});
