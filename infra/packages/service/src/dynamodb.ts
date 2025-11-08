import * as aws from '@pulumi/aws';
import type { TableArgs } from '@pulumi/aws/dynamodb';
import * as pulumi from '@pulumi/pulumi';
import { stack } from '@shared';

type BaseDynamoDBTableArgs = {
  billingMode?: 'PROVISIONED' | 'PAY_PER_REQUEST';
  tags?: Record<string, string>;
  pointInTimeRecoveryEnabled?: boolean;
};

export type DynamoDBTableArgs = BaseDynamoDBTableArgs &
  Omit<TableArgs, keyof BaseDynamoDBTableArgs>;

export class ServiceDynamoDBTable extends pulumi.ComponentResource {
  public readonly table: aws.dynamodb.Table;
  public readonly policy: aws.iam.Policy;

  constructor(
    serviceName: string,
    name: string,
    args: DynamoDBTableArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    const baseName = `${serviceName}-${name}-${stack}`;
    super('macro:cloud_storage:ServiceDynamoDBTable', baseName, args, opts);

    const {
      billingMode = 'PAY_PER_REQUEST',
      tags,
      pointInTimeRecoveryEnabled = false,
      ...tableArgs
    } = args;

    this.table = new aws.dynamodb.Table(
      baseName,
      {
        billingMode,
        tags,
        pointInTimeRecovery: {
          enabled: pointInTimeRecoveryEnabled,
        },
        ...tableArgs,
      },
      { parent: this }
    );

    this.policy = new aws.iam.Policy(
      `${baseName}-access-policy-${stack}`,
      {
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: [
                'dynamodb:GetItem',
                'dynamodb:BatchGetItem',
                'dynamodb:Query',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:DeleteItem',
                'dynamodb:BatchWriteItem',
              ],
              Resource: [
                pulumi.interpolate`${this.table.arn}`,
                pulumi.interpolate`${this.table.arn}/index/*`,
              ],
            },
          ],
        },
      },
      { parent: this }
    );
  }
}
