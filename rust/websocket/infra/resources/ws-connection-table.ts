import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

interface WebsocketConnectionTableArgs {
  name: string;
  attributes: { name: string; type: string }[];
  hashKey?: string;
  billingMode: string;
  stack: string;
  ttl: boolean;
}

export class WebsocketConnectionTable extends pulumi.ComponentResource {
  public readonly table: aws.dynamodb.Table;
  public readonly policy: aws.iam.Policy;

  constructor(
    name: string,
    args: WebsocketConnectionTableArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('custom:apigateway:WebsocketConnectionTable', name, args, opts);

    const qualifiedName = `${args.name}-${args.stack}`;
    const table = new aws.dynamodb.Table(
      qualifiedName,
      {
        name: qualifiedName,
        attributes: args.attributes,
        hashKey: args.hashKey,
        billingMode: args.billingMode,
        ttl: {
          attributeName: 'ExpiresAtSeconds',
          enabled: args.ttl || false,
        },
      },
      { parent: this },
    );

    const policy = new aws.iam.Policy(
      `${name}-full-access-policy-${args.stack}`,
      {
        policy: pulumi.interpolate`{
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Action": "dynamodb:*",
                        "Resource":  "${table.arn}"
                    }
                ]
            }`,
      },
      { parent: this },
    );

    this.table = table;
    this.policy = policy;

    this.registerOutputs({
      table,
      policy,
    });
  }
}
