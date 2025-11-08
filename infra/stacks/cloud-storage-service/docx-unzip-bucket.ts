import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { stack } from '@shared';

export function attachPolicyToDocxUnzipBucket({
  docxUnzipLambdaRoleArn,
  bulkUploadLambdaRoleArn,
  convertServiceRoleArn,
  cloudStorageServiceRoleArn,
  bucket,
}: {
  docxUnzipLambdaRoleArn: pulumi.Output<string> | string;
  bulkUploadLambdaRoleArn: pulumi.Output<string> | string | undefined;
  convertServiceRoleArn: pulumi.Output<string> | string;
  cloudStorageServiceRoleArn: pulumi.Output<string> | string;
  bucket: aws.s3.Bucket;
}) {
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
      const arnsWithRoles = [
        ...arns,
        docxUnzipLambdaRoleArn,
        cloudStorageServiceRoleArn,
        convertServiceRoleArn,
      ];
      if (bulkUploadLambdaRoleArn) {
        arnsWithRoles.push(bulkUploadLambdaRoleArn);
      }
      return arnsWithRoles;
    });

  const allowDocumentStorageServicePolicyStatement: aws.iam.PolicyStatement = {
    Sid: 'AllowDocumentStorageService',
    Effect: 'Allow',
    Principal: {
      AWS: cloudStorageServiceRoleArn,
    },
    Action: ['s3:PutObject'],
    Resource: [bucket.arn, pulumi.interpolate`${bucket.arn}/*`],
  };

  const allowConvertServicePolicyStatement: aws.iam.PolicyStatement = {
    Sid: 'AllowAccessForConvertService',
    Effect: 'Allow',
    Principal: {
      AWS: convertServiceRoleArn,
    },
    Action: ['s3:ListBucket', 's3:GetObject', 's3:PutObject'],
    Resource: [bucket.arn, pulumi.interpolate`${bucket.arn}/*`],
  };

  const allowDocxUnzipLambdaPolicyStatement: aws.iam.PolicyStatement = {
    Sid: 'AllowAccessForDocxUnzipLambda',
    Effect: 'Allow',
    Principal: {
      AWS: docxUnzipLambdaRoleArn,
    },
    Action: [
      's3:ListBucket',
      's3:GetObject',
      's3:PutObject',
      's3:DeleteObject',
    ],
    Resource: [bucket.arn, pulumi.interpolate`${bucket.arn}/*`],
  };

  const bulkUploadLambdaPolicyStatement: aws.iam.PolicyStatement | undefined =
    bulkUploadLambdaRoleArn
      ? {
          Sid: 'AllowAccessForBulkUploadLambda',
          Effect: 'Allow',
          Principal: {
            AWS: bulkUploadLambdaRoleArn,
          },
          Action: [
            's3:ListBucket',
            's3:GetObject',
            's3:PutObject',
            's3:DeleteObject',
          ],
          Resource: [bucket.arn, pulumi.interpolate`${bucket.arn}/*`],
        }
      : undefined;

  const devPolicyStatements: aws.iam.PolicyStatement[] = [
    allowDocumentStorageServicePolicyStatement,
    allowConvertServicePolicyStatement,
    allowDocxUnzipLambdaPolicyStatement,
    {
      Sid: 'DenyNonBucketPolicyAccessForNonAdmins',
      Effect: 'Deny',
      Principal: '*',
      NotAction: [
        's3:GetBucketPolicy',
        's3:PutBucketPolicy',
        's3:DeleteBucketPolicy',
      ],
      Resource: [
        pulumi.interpolate`${bucket.arn}`,
        pulumi.interpolate`${bucket.arn}/*`,
      ],
      Condition: {
        ArnNotEquals: {
          'aws:PrincipalArn': adminUserArnsWithRoles,
        },
      },
    },
  ];

  if (bulkUploadLambdaPolicyStatement) {
    devPolicyStatements.push(bulkUploadLambdaPolicyStatement);
  }

  const s3BucketDevPolicy: aws.iam.PolicyDocument = {
    Version: '2012-10-17',
    Id: 'PolicyForDocxUploadPrivateContent',
    Statement: devPolicyStatements,
  };

  const prodPolicyStatements: aws.iam.PolicyStatement[] = [
    allowDocumentStorageServicePolicyStatement,
    allowConvertServicePolicyStatement,
    allowDocxUnzipLambdaPolicyStatement,
    {
      Sid: 'DenyNonAdminAccess',
      Effect: 'Deny',
      Principal: '*',
      Action: 's3:*',
      Resource: [
        pulumi.interpolate`${bucket.arn}`,
        pulumi.interpolate`${bucket.arn}/*`,
      ],
      Condition: {
        ArnNotEquals: {
          'aws:PrincipalArn': adminUserArnsWithRoles,
        },
      },
    },
    {
      Sid: 'OnlyAllowAdminAccessToBucketPolicy',
      Effect: 'Deny',
      Principal: '*',
      NotAction: [
        's3:ListBucket',
        's3:DeleteBucket',
        's3:PutBucketLogging',
        's3:GetBucketPolicy',
        's3:PutBucketPolicy',
        's3:DeleteBucketPolicy',
        's3:GetBucketVersioning',
        's3:GetBucketTagging',
        's3:GetEncryptionConfiguration',
        's3:GetIntelligentTieringConfiguration',
        's3:GetBucketLogging',
        's3:GetBucketNotification',
        's3:GetAccelerateConfiguration',
        's3:GetBucketObjectLockConfiguration',
        's3:GetBucketRequestPayment',
        's3:GetBucketWebsite',
        's3:GetBucketPublicAccessBlock',
        's3:GetBucketPolicy',
        's3:GetBucketOwnershipControls',
        's3:GetBucketAcl',
        's3:GetBucketCORS',
        's3:PutBucketCORS',
        's3:GetAnalyticsConfiguration',
        's3:GetReplicationConfiguration',
        's3:GetLifecycleConfiguration',
        's3:GetInventoryConfiguration',
      ],
      Resource: [
        pulumi.interpolate`${bucket.arn}`,
        pulumi.interpolate`${bucket.arn}/*`,
      ],
      Condition: {
        ArnEquals: {
          // Explicitly only enforce admins to have this restricted access
          'aws:PrincipalArn': adminUserArns,
        },
      },
    },
  ];

  if (bulkUploadLambdaPolicyStatement) {
    prodPolicyStatements.push(bulkUploadLambdaPolicyStatement);
  }

  const s3BucketProdPolicy: aws.iam.PolicyDocument = {
    Version: '2012-10-17',
    Id: 'PolicyForCloudFrontPrivateContent',
    Statement: prodPolicyStatements,
  };

  bucket.bucket.apply(
    (pulumiId) =>
      new aws.s3.BucketPolicy(
        `docx-upload-bucket-policy-${pulumiId}-${stack}`,
        {
          bucket: bucket.id,
          policy: stack === 'prod' ? s3BucketProdPolicy : s3BucketDevPolicy,
        },
        { protect: true }
      )
  );
}
