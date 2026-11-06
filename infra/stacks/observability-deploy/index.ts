// The identity and throwaway resources the observability deploy workflow uses.
// Kept apart from the observability stack, which that workflow deploys, so the
// workflow can never change its own permissions. Deployed by hand.
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { deployStatements } from './policy';

const region = aws.config.requireRegion();
if (pulumi.getStack() !== 'prod' || region !== 'us-east-2') {
  throw new Error('Only the prod stack in us-east-2 exists');
}
const account = '569036502058';
const tags = { project: 'observability', environment: 'prod' };
const smokeTag = 'observability-smoke';
// Created by hand with the first image; see the observability README.
const imageBucket = `macro-observability-images-${account}-${region}`;
const importRole = 'macro-observability-vmimport';
// Owned by the observability stack (ci.ts).
const github = aws.iam.getOpenIdConnectProviderOutput({
  url: 'https://token.actions.githubusercontent.com',
});

// Throwaway storage for smoke hosts. Telemetry written there is only the
// smoke check's own, so it expires after a day.
function smokeBucket(name: string) {
  const bucket = new aws.s3.BucketV2(name, { forceDestroy: true, tags });
  new aws.s3.BucketPublicAccessBlock(`${name}-private`, {
    bucket: bucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  });
  new aws.s3.BucketServerSideEncryptionConfigurationV2(`${name}-encryption`, {
    bucket: bucket.id,
    rules: [{ applyServerSideEncryptionByDefault: { sseAlgorithm: 'AES256' } }],
  });
  new aws.s3.BucketLifecycleConfigurationV2(`${name}-expiry`, {
    bucket: bucket.id,
    rules: [
      {
        id: 'expire-smoke-telemetry',
        status: 'Enabled',
        filter: { prefix: '' },
        expiration: { days: 1 },
        abortIncompleteMultipartUpload: { daysAfterInitiation: 1 },
      },
    ],
  });
  return bucket;
}
const smokeLogs = smokeBucket('observability-smoke-logs');
const smokeTraces = smokeBucket('observability-smoke-traces');

// The image reads credentials only from Secrets Manager. This one holds
// throwaway values the workflow generates for each smoke boot; no real
// credential is ever stored in it, so it is not a Doppler secret.
const smokeSecret = new aws.secretsmanager.Secret('observability-smoke', {
  name: 'observability/smoke',
  description: 'Throwaway credentials for observability AMI smoke boots',
  recoveryWindowInDays: 0,
  tags,
});

// The smoke host may reach only its own buckets and secret, plus SSM for the
// check. No CloudWatch, SNS or production storage: it must not page anyone.
const smokeRole = new aws.iam.Role('observability-smoke-host', {
  name: 'macro-observability-smoke-host',
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: 'ec2.amazonaws.com',
  }),
  tags,
});
new aws.iam.RolePolicyAttachment('observability-smoke-ssm', {
  role: smokeRole.name,
  policyArn: 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore',
});
new aws.iam.RolePolicy('observability-smoke-storage', {
  role: smokeRole.id,
  policy: pulumi.jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: [
          's3:ListBucket',
          's3:GetBucketLocation',
          's3:ListBucketMultipartUploads',
        ],
        Resource: [smokeLogs.arn, smokeTraces.arn],
      },
      {
        Effect: 'Allow',
        Action: [
          's3:GetObject',
          's3:PutObject',
          's3:DeleteObject',
          's3:AbortMultipartUpload',
          's3:ListMultipartUploadParts',
        ],
        Resource: [
          pulumi.interpolate`${smokeLogs.arn}/*`,
          pulumi.interpolate`${smokeTraces.arn}/*`,
        ],
      },
      {
        Effect: 'Allow',
        Action: 'secretsmanager:GetSecretValue',
        Resource: smokeSecret.arn,
      },
    ],
  }),
});
const smokeProfile = new aws.iam.InstanceProfile('observability-smoke-host', {
  name: 'macro-observability-smoke-host',
  role: smokeRole.name,
});

// Assumable only by workflows running main's code, like macro-observability-ci.
export const deployRole = new aws.iam.Role('observability-deploy', {
  name: 'macro-observability-deploy',
  description:
    'The observability deploy workflow: publish, smoke-boot and roll out the host AMI',
  // Publishing waits on a VM import that can take most of an hour.
  maxSessionDuration: 7200,
  assumeRolePolicy: pulumi.jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { Federated: github.arn },
        Action: 'sts:AssumeRoleWithWebIdentity',
        Condition: {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            'token.actions.githubusercontent.com:sub':
              'repo:macro-inc/macro:ref:refs/heads/main',
          },
        },
      },
    ],
  }),
  tags,
});

new aws.iam.RolePolicy('observability-deploy', {
  role: deployRole.id,
  policy: pulumi
    .all([smokeRole.arn, smokeSecret.arn])
    .apply(([smokeRoleArn, smokeSecretArn]) =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: deployStatements({
          account,
          region,
          imageBucket,
          importRole,
          smokeTag,
          smokeRoleArn,
          smokeSecretArn,
        }),
      })
    ),
});

export const deployRoleArn = deployRole.arn;
export const smokeInstanceProfile = smokeProfile.name;
export const smokeSecretArn = smokeSecret.arn;
export const smokeLogsBucket = smokeLogs.bucket;
export const smokeTracesBucket = smokeTraces.bucket;
