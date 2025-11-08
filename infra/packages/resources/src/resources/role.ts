import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { stack } from '@shared';

export function createShaCleanupWorkerRole(
  baseName: string,
  documentStorageBucketArn: pulumi.Output<string> | string
) {
  const docStorageBucketPolicy = new aws.iam.Policy(
    `${baseName}-doc-storage-policy-${stack}`,
    {
      name: `${baseName}-doc-storage-bucket-policy-${stack}`,
      policy: {
        Version: '2012-10-17',
        Statement: [
          {
            Action: ['s3:DeleteObject'],
            Resource: [
              documentStorageBucketArn,
              pulumi.interpolate`${documentStorageBucketArn}/*`,
            ],
            Effect: 'Allow',
          },
        ],
      },
    }
  );

  const taskRole = new aws.iam.Role(`${baseName}-role-${stack}`, {
    name: `${baseName}-role-${stack}`,
    assumeRolePolicy: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Principal: {
            Service: 'ecs-tasks.amazonaws.com',
          },
          Effect: 'Allow',
          Sid: '',
        },
      ],
    },
  });

  new aws.iam.RolePolicyAttachment(
    `${baseName}-role-doc-storage-att-${stack}`,
    {
      role: taskRole,
      policyArn: docStorageBucketPolicy.arn,
    }
  );

  return taskRole;
}

export function createServiceRole({
  serviceName,
  documentStorageBucket,
  cloudStorageDocumentMappingTable,
  cloudStorageDocumentPermissionsTable,
}: {
  serviceName: string;
  documentStorageBucket: aws.s3.Bucket;
  cloudStorageDocumentMappingTable: aws.dynamodb.Table;
  cloudStorageDocumentPermissionsTable: aws.dynamodb.Table;
}) {
  const docStorageBucketPolicy = new aws.iam.Policy(
    `${serviceName}-doc-storage-policy-${stack}`,
    {
      name: `${serviceName}-doc-storage-bucket-policy-${stack}`,
      policy: {
        Version: '2012-10-17',
        Statement: [
          {
            Action: [
              's3:ListBucket',
              's3:GetObject',
              's3:PutObject',
              's3:DeleteObject',
            ],
            Resource: [
              documentStorageBucket.arn,
              pulumi.interpolate`${documentStorageBucket.arn}/*`,
              // docxUploadBucket.arn,
              // pulumi.interpolate`${docxUploadBucket.arn}/*`,
            ],
            Effect: 'Allow',
          },
        ],
      },
    }
  );

  const docStorageTablePolicy = new aws.iam.Policy(
    `${serviceName}-doc-storage-table-policy-${stack}`,
    {
      name: `${serviceName}-doc-storage-table-policy-${stack}`,
      policy: {
        Version: '2012-10-17',
        Statement: [
          {
            Action: ['dynamodb:*'],
            Resource: [
              pulumi.interpolate`${cloudStorageDocumentMappingTable.arn}`,
              pulumi.interpolate`${cloudStorageDocumentPermissionsTable.arn}`,
            ],
            Effect: 'Allow',
          },
        ],
      },
    }
  );

  const taskRole = new aws.iam.Role(`${serviceName}-role-${stack}`, {
    name: `${serviceName}-role-${stack}`,
    assumeRolePolicy: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Principal: {
            Service: 'ecs-tasks.amazonaws.com',
          },
          Effect: 'Allow',
          Sid: '',
        },
      ],
    },
  });

  new aws.iam.RolePolicyAttachment(
    `${serviceName}-role-doc-storage-att-${stack}`,
    {
      role: taskRole,
      policyArn: docStorageBucketPolicy.arn,
    }
  );

  new aws.iam.RolePolicyAttachment(
    `${serviceName}-role-doc-storage-table-att-${stack}`,
    {
      role: taskRole,
      policyArn: docStorageTablePolicy.arn,
    }
  );

  return taskRole;
}
