import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { stack } from '@shared';

export function setupReplicationBucket() {
  const replicationRegion = new aws.Provider(`replica-${stack}`, {
    region: 'us-west-1',
  });
  const bucketName = `macro-doc-storage-replication${
    stack === 'prod' ? '' : `-${stack}`
  }`;
  const replicationBucket = new aws.s3.Bucket(
    'replication-bucket',
    {
      bucket: bucketName,
      versioning: {
        enabled: true,
        mfaDelete: false,
      },
      loggings:
        stack === 'prod'
          ? [
              {
                targetBucket: 'macro-access-log-bucket-uswest2',
                targetPrefix: `${bucketName}-${stack}`,
              },
            ]
          : undefined,
    },
    { provider: replicationRegion }
  );

  const replicationRole = new aws.iam.Role('replication-role', {
    name: `replication-role-${stack}`,
    assumeRolePolicy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
          Principal: {
            Service: 's3.amazonaws.com',
          },
        },
      ],
    }),
  });

  // Get admin group
  const groupName = `document-store-admin-${stack}`;

  const adminGroup = aws.iam.getGroup({
    groupName,
  });

  const adminUserArns = adminGroup
    .then((group) => group.users.map((user) => user.arn))
    .then((arns) => {
      return [...arns];
    });
  const adminUserArnsWithRoles = adminGroup
    .then((group) => group.users.map((user) => user.arn))
    .then((arns) => {
      return [...arns, pulumi.interpolate`${replicationRole.arn}`];
    });

  new aws.iam.RolePolicyAttachment(
    'replication-policy-attachment',
    {
      role: replicationRole.name,
      policyArn: aws.iam.ManagedPolicy.AmazonS3FullAccess,
    },
    { dependsOn: [replicationRole] }
  );

  const policy: aws.iam.PolicyDocument = {
    Version: '2012-10-17',
    Id: 'PolicyForReplicationBucket',
    Statement: [
      {
        Sid: 'AllowReplicationForReplicationRole',
        Action: [
          's3:GetReplicationConfiguration',
          's3:ListBucket',
          's3:GetObjectVersion',
          's3:GetObjectVersionAcl',
          's3:GetObjectVersionTagging',
        ],
        Effect: 'Allow',
        Principal: {
          AWS: pulumi.interpolate`${replicationRole.arn}`,
        },
        Resource: [
          pulumi.interpolate`${replicationBucket.arn}`,
          pulumi.interpolate`${replicationBucket.arn}/*`,
        ],
      },
      {
        Sid: 'DenyNonAdminAccess',
        Effect: 'Deny',
        Principal: '*',
        Action: 's3:*',
        Resource: [
          pulumi.interpolate`${replicationBucket.arn}`,
          pulumi.interpolate`${replicationBucket.arn}/*`,
        ],
        Condition: {
          ArnNotEquals: {
            // Explicitly do not deny access to admins and all roles
            'aws:PrincipalArn': adminUserArnsWithRoles,
          },
        },
      },
      {
        Sid: 'OnlyAllowAdminAccessToBucketPolicy',
        Effect: 'Deny',
        Principal: '*',
        NotAction: [
          's3:GetBucketPolicy',
          's3:PutBucketPolicy',
          's3:DeleteBucketPolicy',
          // Used to allow admins to create bucket events
          's3:PutBucketNotification',
          's3:GetBucketNotification',
          // Bucket configuration
          's3:GetReplicationConfiguration',
          's3:PutReplicationConfiguration',
          's3:GetLifecycleConfiguration',
          's3:GetAccountPublicAccessBlock',
          's3:GetBucketOwnershipControls',
          's3:GetBucketAcl',
          's3:GetBucketVersioning',
          's3:GetBucketTagging',
          's3:GetEncryptionConfiguration',
          's3:GetIntelligentTieringConfiguration',
          's3:GetBucketLogging',
          's3:PutBucketLogging',
          's3:GetBucketWebsite',
          's3:GetBucketRequestPayment',
          's3:GetBucketObjectLockConfiguration',
          's3:GetAccelerateConfiguration',
          's3:GetAccountPublicAccessBlock',
          's3:GetAnalyticsConfiguration',
          's3:GetInventoryConfiguration',
          's3:GetBucketCORS',
          's3:PutBucketCORS',
          // Useful for admins only
          's3:DeleteBucket',
          's3:ListBucket',
        ],
        Resource: [
          pulumi.interpolate`${replicationBucket.arn}`,
          pulumi.interpolate`${replicationBucket.arn}/*`,
        ],
        Condition: {
          ArnEquals: {
            // Explicitly only enforce admins to have this restricted access
            'aws:PrincipalArn': adminUserArns,
          },
        },
      },
    ],
  };

  const bucketPolicy = replicationBucket.bucket.apply(
    (pulumiId) =>
      new aws.s3.BucketPolicy(
        // pulumiId contains stack name
        `replication-policy-${pulumiId}`,
        {
          bucket: replicationBucket.id,
          policy: policy,
        },
        { protect: true, provider: replicationRegion }
      )
  );

  return {
    bucket: replicationBucket,
    role: replicationRole,
    policy: bucketPolicy,
  };
}
