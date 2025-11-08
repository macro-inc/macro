import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { stack } from '@shared';

type DynamoDBTableArgs = {
  baseName: string;
  // Optionally override the name of the table (static name)
  staticNameOverride?: string;
  attributes: aws.types.input.dynamodb.TableAttribute[];
  hashKey: string;
  rangeKey?: string;
  globalSecondaryIndexes?: aws.types.input.dynamodb.TableGlobalSecondaryIndex[];
  billingMode?: 'PROVISIONED' | 'PAY_PER_REQUEST';
  tags?: { [key: string]: string };
  pointInTimeRecoveryEnabled?: boolean;
};

export class DynamoDBTable extends pulumi.ComponentResource {
  public readonly table: aws.dynamodb.Table;
  public readonly policy: aws.iam.Policy;

  constructor(
    name: string,
    args: DynamoDBTableArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:DynamoDBTable', name, {}, opts);

    const {
      baseName,
      staticNameOverride: nameOverride,
      attributes,
      hashKey,
      rangeKey,
      globalSecondaryIndexes,
      billingMode = 'PAY_PER_REQUEST',
      tags,
      pointInTimeRecoveryEnabled = stack === 'prod',
    } = args;

    this.table = new aws.dynamodb.Table(
      `${baseName}-${stack}`,
      {
        name: nameOverride,
        attributes,
        hashKey,
        rangeKey,
        globalSecondaryIndexes,
        billingMode,
        tags,
        pointInTimeRecovery: {
          enabled: pointInTimeRecoveryEnabled,
        },
      },
      { parent: this }
    );

    this.policy = new aws.iam.Policy(
      `${baseName}-access-policy-${stack}`,
      {
        policy: pulumi.interpolate`{
          "Version": "2012-10-17",
          "Statement": [
            {
              "Effect": "Allow",
              "Action": "dynamodb:*",
              "Resource": [
                "${this.table.arn}",
                "${this.table.arn}/index/*"
              ]
            }
          ]
        }`,
      },
      { parent: this }
    );
  }
}
