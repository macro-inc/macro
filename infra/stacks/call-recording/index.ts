import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { createBucket } from '../../packages/resources';
import { stack } from '../../packages/shared';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'call-recording',
};

// ---------------------------------------------------------------------------
// Bucket
// ---------------------------------------------------------------------------
const callRecordingBucket = createBucket({
  id: `macro-call-recording-${stack}`,
  bucketName: `macro-call-recording-${stack}`,
  transferAcceleration: stack === 'prod',
  enableVersioning: false,
  exposeHeaders: ['Content-Length', 'Content-Range'],
  tags,
});

export const callRecordingBucketId = callRecordingBucket.id;
export const callRecordingBucketArn = callRecordingBucket.arn;

// ---------------------------------------------------------------------------
// 1. IAM Policies (attach to users or roles)
// ---------------------------------------------------------------------------

// CRUD — standard object operations on the bucket
const crudPolicy = new aws.iam.Policy(`macro-call-recording-crud-${stack}`, {
  name: `macro-call-recording-crud-${stack}`,
  description: 'CRUD access to call recording objects',
  policy: pulumi.all([callRecordingBucket.arn]).apply(([bucketArn]) =>
    JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'ListBucket',
          Effect: 'Allow',
          Action: ['s3:ListBucket', 's3:GetBucketLocation'],
          Resource: bucketArn,
        },
        {
          Sid: 'ObjectCrud',
          Effect: 'Allow',
          Action: [
            's3:ListBucket',
            's3:GetObject',
            's3:PutObject',
            's3:DeleteObject',
            's3:HeadObject',
            's3:ListMultipartUploadParts',
            's3:ListBucketMultipartUploads',
            's3:AbortMultipartUpload',
          ],
          Resource: `${bucketArn}/*`,
        },
      ],
    })
  ),
  tags,
});

export const crudPolicyArn = crudPolicy.arn;

// Modify — bucket-level admin (policy, ACL, versioning, lifecycle, etc.)
const modifyPolicy = new aws.iam.Policy(
  `macro-call-recording-modify-${stack}`,
  {
    name: `macro-call-recording-modify-${stack}`,
    description: 'Admin/modify access to call recording bucket configuration',
    policy: pulumi.all([callRecordingBucket.arn]).apply(([bucketArn]) =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'BucketAdmin',
            Effect: 'Allow',
            Action: [
              's3:PutBucketCORS',
              's3:ListBucket',
              's3:PutBucketLogging',
              's3:PutBucketPolicy',
              's3:DeleteBucketPolicy',
              's3:GetBucketVersioning',
              's3:PutBucketVersioning',
              's3:GetBucketTagging',
              's3:GetEncryptionConfiguration',
              's3:PutEncryptionConfiguration',
              's3:GetIntelligentTieringConfiguration',
              's3:GetBucketLogging',
              's3:GetBucketNotification',
              's3:PutBucketNotification',
              's3:GetAccelerateConfiguration',
              's3:GetBucketObjectLockConfiguration',
              's3:GetBucketRequestPayment',
              's3:GetBucketWebsite',
              's3:GetBucketPublicAccessBlock',
              's3:GetBucketPolicy',
              's3:GetBucketOwnershipControls',
              's3:GetBucketAcl',
              's3:PutBucketAcl',
              's3:GetBucketCORS',
              's3:GetAnalyticsConfiguration',
              's3:GetReplicationConfiguration',
              's3:PutReplicationConfiguration',
              's3:GetLifecycleConfiguration',
              's3:PutLifecycleConfiguration',
              's3:GetInventoryConfiguration',
              's3:PutInventoryConfiguration',
              's3:DeleteInventoryConfiguration',
              's3:DeleteBucket',
              's3:PutBucketTagging',
              's3:DeleteBucketTagging',
              's3:PutBucketPublicAccessBlock',
              's3:DeletePublicAccessBlock',
              's3:PutBucketOwnershipControls',
              's3:PutAccelerateConfiguration',
              's3:PutBucketObjectLockConfiguration',
              's3:PutAnalyticsConfiguration',
              's3:DeleteAnalyticsConfiguration',
              's3:PutIntelligentTieringConfiguration',
              's3:DeleteIntelligentTieringConfiguration',
              's3:PutBucketWebsite',
              's3:DeleteBucketWebsite',
              's3:PutBucketRequestPayment',
              's3:GetMetricsConfiguration',
              's3:PutMetricsConfiguration',
              's3:DeleteMetricsConfiguration',
            ],
            Resource: bucketArn,
          },
        ],
      })
    ),
    tags,
  }
);

export const modifyPolicyArn = modifyPolicy.arn;

// ---------------------------------------------------------------------------
// 2. Service IAM User with CRUD access
// ---------------------------------------------------------------------------

const serviceUser = new aws.iam.User(`macro-call-recording-svc-${stack}`, {
  name: `macro-call-recording-svc-${stack}`,
  tags: { ...tags, 'call-recording-access': 'true' },
});

new aws.iam.UserPolicyAttachment(`macro-call-recording-svc-crud-${stack}`, {
  user: serviceUser.name,
  policyArn: crudPolicy.arn,
});

const serviceUserAccessKey = new aws.iam.AccessKey(
  `macro-call-recording-svc-key-${stack}`,
  {
    user: serviceUser.name,
  }
);

// Store credentials in Secrets Manager — NOT exported
const serviceUserSecret = new aws.secretsmanager.Secret(
  `macro-call-recording-svc-creds-${stack}`,
  {
    name: `macro-call-recording-svc-creds-${stack}`,
    description: 'IAM credentials for call recording bucket service user',
    tags,
  }
);

export const serviceUserSecretId = serviceUserSecret.id;
export const serviceUserSecretArn = serviceUserSecret.arn;

new aws.secretsmanager.SecretVersion(
  `macro-call-recording-svc-creds-version-${stack}`,
  {
    secretId: serviceUserSecret.id,
    secretString: pulumi
      .all([serviceUserAccessKey.id, serviceUserAccessKey.secret])
      .apply(([accessKey, secretAccessKey]) =>
        JSON.stringify({ accessKey, secretAccessKey })
      ),
  }
);

// ---------------------------------------------------------------------------
// 3. Bucket Policy — tag-based access control
// ---------------------------------------------------------------------------
// Denies all access unless the caller's principal is tagged with
// call-recording-access: "true". This blocks broad dev IAM permissions.
//
// When attaching crudPolicy or modifyPolicy to a user/role, also tag them
// with { 'call-recording-access': 'true' } to grant access.

const bucketPolicy = new aws.s3.BucketPolicy(
  `macro-call-recording-policy-${stack}`,
  {
    bucket: callRecordingBucket.id,
    policy: callRecordingBucket.arn.apply((bucketArn) =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'DenyWithoutTag',
            Effect: 'Deny',
            Principal: '*',
            Action: 's3:*',
            Resource: [bucketArn, `${bucketArn}/*`],
            Condition: {
              StringNotEquals: {
                'aws:PrincipalTag/call-recording-access': 'true',
              },
              // Never deny the account root — prevents lockout
              ArnNotEquals: {
                'aws:PrincipalArn': `arn:aws:iam::569036502058:root`,
              },
            },
          },
        ],
      })
    ),
  }
);

export const bucketPolicyId = bucketPolicy.id;
