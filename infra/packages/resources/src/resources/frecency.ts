import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { stack } from '@shared';

/**
 * Creates an IAM policy for accessing the frecency DynamoDB table.
 * This table is created at runtime by the frecency crate, so we need
 * permissions to create it if it doesn't exist, as well as read/write access.
 */
export function createFrecencyTablePolicy(
  name: string,
  opts?: pulumi.ComponentResourceOptions
): aws.iam.Policy {
  return new aws.iam.Policy(
    name,
    {
      name: `${name}-${stack}`,
      policy: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              // Table creation (since it's created at runtime by the frecency crate)
              'dynamodb:CreateTable',
              'dynamodb:DescribeTable',
              'dynamodb:ListTables',
              // Read operations
              'dynamodb:Query',
              'dynamodb:GetItem',
              'dynamodb:BatchGetItem',
              'dynamodb:Scan',
              // Write operations
              'dynamodb:PutItem',
              'dynamodb:UpdateItem',
              'dynamodb:DeleteItem',
              'dynamodb:BatchWriteItem',
              // Table management
              'dynamodb:UpdateTimeToLive',
              'dynamodb:DescribeTimeToLive',
            ],
            Resource: [
              pulumi.interpolate`arn:aws:dynamodb:*:*:table/frecency-${stack}`,
              pulumi.interpolate`arn:aws:dynamodb:*:*:table/frecency-${stack}/*`,
            ],
          },
        ],
      },
      tags: {
        environment: stack,
        purpose: 'frecency-table-access',
      },
    },
    opts
  );
}

/**
 * Helper function to attach the frecency table policy to an IAM role
 */
export function attachFrecencyTablePolicy(
  attachmentName: string,
  role: aws.iam.Role,
  policy: aws.iam.Policy,
  opts?: pulumi.ComponentResourceOptions
): aws.iam.RolePolicyAttachment {
  return new aws.iam.RolePolicyAttachment(
    attachmentName,
    {
      role: role.name,
      policyArn: policy.arn,
    },
    { ...opts, dependsOn: [policy, role] }
  );
}
