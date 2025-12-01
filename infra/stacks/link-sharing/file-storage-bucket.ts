import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, stack } from '@shared';

const BASE_NAME = 'link-sharing-demo-file-storage';

export interface GetStorageBucketResult {
  id: string;
  arn: string;
  bucket: string; // bucket name
  region: string;
}

export const getStorageBucketFromName = (
  bucketName: string | pulumi.Output<string>
): pulumi.Output<GetStorageBucketResult> => {
  if (typeof bucketName === 'string') {
    bucketName = pulumi.output(bucketName);
  }

  const bucketResult = bucketName.apply((name) =>
    aws.s3.getBucket({
      bucket: name,
    })
  );
  return bucketResult.apply((bucket) => ({
    id: bucket.id,
    arn: bucket.arn,
    bucket: bucket.bucket,
    region: bucket.region,
  }));
};

export const attachPolicyToBucket = ({
  cloudfrontDistributionArn,
  bucket,
  docStorageRoleArn,
  docxUnzipRoleArn,
  shaCleanupWorkerArn,
  documentTextExtractorArn,
  documentProcessingServiceRoleArn,
  pdfPreprocessLambdaRoleArn,
  documentStorageBucketReplicationRoleArn,
  deleteDocumentWorkerRoleArn,
  searchProcessingServiceRoleArn,
  bulkUploadLambdaRoleArn,
  convertServiceRoleArn,
}: {
  cloudfrontDistributionArn: pulumi.Output<string>;
  bucket: pulumi.Output<GetStorageBucketResult>;
  docStorageRoleArn: pulumi.Output<string>;
  docxUnzipRoleArn: pulumi.Output<string>;
  documentTextExtractorArn: pulumi.Output<string>;
  shaCleanupWorkerArn: pulumi.Output<string>;
  documentProcessingServiceRoleArn: pulumi.Output<string>;
  pdfPreprocessLambdaRoleArn: pulumi.Output<string>;
  documentStorageBucketReplicationRoleArn: pulumi.Output<string>;
  deleteDocumentWorkerRoleArn: pulumi.Output<string>;
  searchProcessingServiceRoleArn: pulumi.Output<string>;
  bulkUploadLambdaRoleArn: pulumi.Output<string>;
  convertServiceRoleArn: pulumi.Output<string>;
}) => {
  const groupName = config.require('adminGroupName');

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
      // Adding in role that is assumed by Document Storage Service since that needs to not be implicitly denied
      return [
        ...arns,
        docStorageRoleArn,
        docxUnzipRoleArn,
        shaCleanupWorkerArn,
        documentProcessingServiceRoleArn,
        pdfPreprocessLambdaRoleArn,
        documentStorageBucketReplicationRoleArn,
        deleteDocumentWorkerRoleArn,
        documentTextExtractorArn,
        searchProcessingServiceRoleArn,
        bulkUploadLambdaRoleArn,
        convertServiceRoleArn,
      ];
    });

  const additionalAdminActions =
    stack === 'dev' ? ['s3:GetObject', 's3:PutObject'] : [];

  const policy: aws.iam.PolicyDocument = {
    Version: '2012-10-17',
    Id: 'PolicyForCloudFrontPrivateContent',
    Statement: [
      {
        Sid: 'S3ServerAccessLogsPolicy',
        Effect: 'Allow',
        Principal: {
          Service: 'logging.s3.amazonaws.com',
        },
        Action: 's3:PutObject',
        Resource: [bucket.arn, pulumi.interpolate`${bucket.arn}/*`],
        Condition: {
          StringEquals: {
            'aws:SourceAccount': '569036502058',
          },
        },
      },
      {
        Sid: 'AllowAccessForReplication',
        Effect: 'Allow',
        Principal: {
          AWS: documentStorageBucketReplicationRoleArn,
        },
        Action: [
          // All access is necessary here.
          // Role is scoped for all access as well
          's3:*',
        ],
        Resource: [bucket.arn, pulumi.interpolate`${bucket.arn}/*`],
      },
      {
        Sid: 'AllowAccessForDocumentStorageService',
        Effect: 'Allow',
        Principal: {
          AWS: docStorageRoleArn,
        },
        Action: [
          's3:ListBucket',
          's3:GetObject',
          's3:PutObject',
          's3:DeleteObject',
        ],
        Resource: [bucket.arn, pulumi.interpolate`${bucket.arn}/*`],
      },
      {
        Sid: 'AllowAccessForSearchProcessing',
        Effect: 'Allow',
        Principal: {
          AWS: searchProcessingServiceRoleArn,
        },
        Action: ['s3:ListBucket', 's3:GetObject'],
        Resource: [bucket.arn, pulumi.interpolate`${bucket.arn}/*`],
      },
      {
        Sid: 'AllowAccessForDocxUnzipLambda',
        Effect: 'Allow',
        Principal: {
          AWS: docxUnzipRoleArn,
        },
        Action: ['s3:ListBucket', 's3:GetObject', 's3:PutObject'],
        Resource: [bucket.arn, pulumi.interpolate`${bucket.arn}/*`],
      },
      {
        Sid: 'AllowAccessForConvertService',
        Effect: 'Allow',
        Principal: {
          AWS: convertServiceRoleArn,
        },
        Action: ['s3:ListBucket', 's3:GetObject', 's3:PutObject'],
        Resource: [bucket.arn, pulumi.interpolate`${bucket.arn}/*`],
      },
      {
        Sid: 'AllowAccessForBulkUploadLambda',
        Effect: 'Allow',
        Principal: {
          AWS: bulkUploadLambdaRoleArn,
        },
        Action: ['s3:PutObject'],
        Resource: [bucket.arn, pulumi.interpolate`${bucket.arn}/*`],
      },
      {
        Sid: 'AllowAccessForDeleteDocumentWorker',
        Effect: 'Allow',
        Principal: {
          AWS: deleteDocumentWorkerRoleArn,
        },
        Action: ['s3:ListBucket', 's3:GetObject', 's3:DeleteObject'],
        Resource: [bucket.arn, pulumi.interpolate`${bucket.arn}/*`],
      },
      {
        Sid: 'AllowAccessForShaCleanupWorker',
        Effect: 'Allow',
        Principal: {
          AWS: shaCleanupWorkerArn,
        },
        Action: ['s3:DeleteObject'],
        Resource: [bucket.arn, pulumi.interpolate`${bucket.arn}/*`],
      },
      {
        Sid: 'AllowAccessForDocumentTextExtractor',
        Effect: 'Allow',
        Principal: {
          AWS: documentTextExtractorArn,
        },
        Action: ['s3:GetObject', 's3:ListBucket'],
        Resource: [bucket.arn, pulumi.interpolate`${bucket.arn}/*`],
      },
      {
        Sid: 'AllowAccessForDocumentProcessingService',
        Effect: 'Allow',
        Principal: {
          AWS: documentProcessingServiceRoleArn,
        },
        Action: ['s3:GetObject', 's3:PutObject'],
        Resource: [bucket.arn, pulumi.interpolate`${bucket.arn}/*`],
      },
      {
        Sid: 'AllowAccessForPdfPreprocessLambda',
        Effect: 'Allow',
        Principal: {
          AWS: pdfPreprocessLambdaRoleArn,
        },
        Action: ['s3:GetObject', 's3:PutObject'],
        Resource: [bucket.arn, pulumi.interpolate`${bucket.arn}/*`],
      },
      {
        Sid: 'AllowCloudFrontServicePrincipal',
        Effect: 'Allow',
        Principal: {
          Service: 'cloudfront.amazonaws.com',
        },
        Action: ['s3:GetObject', 's3:PutObject'],
        Resource: pulumi.interpolate`${bucket.arn}/*`,
        Condition: {
          ArnEquals: {
            'aws:SourceArn': cloudfrontDistributionArn,
          },
        },
      },
      {
        Sid: 'AllowAdminsBucketAccess',
        Effect: 'Allow',
        Principal: {
          AWS: adminUserArns,
        },
        Action: [
          ...additionalAdminActions,
          's3:PutBucketCORS',
          's3:ListBucket',
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
          's3:GetAnalyticsConfiguration',
          's3:GetReplicationConfiguration',
          's3:GetLifecycleConfiguration',
          's3:GetInventoryConfiguration',
          's3:PutReplicationConfiguration',
          's3:PutBucketNotification',
        ],
        Resource: [
          pulumi.interpolate`${bucket.arn}`,
          pulumi.interpolate`${bucket.arn}/*`,
        ],
      },
      {
        Sid: 'ExplicitlyDenyAdminsNonBucketPolicyAccess',
        Effect: 'Deny',
        Principal: {
          AWS: adminUserArns,
        },
        NotAction: [
          ...additionalAdminActions,
          's3:PutBucketCORS',
          's3:ListBucket',
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
          's3:GetAnalyticsConfiguration',
          's3:GetReplicationConfiguration',
          's3:GetLifecycleConfiguration',
          's3:GetInventoryConfiguration',
          's3:PutReplicationConfiguration',
          's3:PutBucketNotification',
        ],
        Resource: [
          pulumi.interpolate`${bucket.arn}`,
          pulumi.interpolate`${bucket.arn}/*`,
        ],
      },
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
            'aws:SourceArn': cloudfrontDistributionArn,
          },
        },
      },
    ],
  };

  const bucketPolicy = bucket.bucket.apply(
    (pulumiId: string) =>
      new aws.s3.BucketPolicy(
        `${BASE_NAME}-bucket-policy-${pulumiId}-${stack}`,
        {
          bucket: bucket.id,
          policy,
        },
        { protect: true }
      )
  );

  return { bucketPolicy };
};
