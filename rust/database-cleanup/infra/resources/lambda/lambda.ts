import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import {
  CLOUDWATCH_KINESIS_STREAM_ROLE_ARN,
  DATADOG_KINESIS_FIREHOSE_STREAM_ARN,
  stack,
} from '../shared';

type LambdaArgs<T extends Record<string, any>> = {
  baseName: string;
  handlerBase: string;
  zipLocation: string;
  envVars?: { [K in keyof T]: pulumi.Output<string> | string };
  role: aws.iam.Role;
  vpc: {
    vpcId: pulumi.Output<string> | string;
    publicSubnetIds: pulumi.Output<string[]> | string[];
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  timeout?: number;
  memorySize?: number;
  tags: { [key: string]: string };
};

export class Lambda<
  T extends Record<string, any>,
> extends pulumi.ComponentResource {
  public lambda: aws.lambda.Function;
  public logGroup: aws.cloudwatch.LogGroup;

  constructor(
    name: string,
    {
      baseName,
      vpc,
      zipLocation,
      envVars,
      role,
      timeout,
      memorySize,
      tags,
    }: LambdaArgs<T>,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super(`components:lambda:${baseName}`, name, {}, opts);
    let lambdaSg: aws.ec2.SecurityGroup | undefined;
    if (vpc) {
      lambdaSg = new aws.ec2.SecurityGroup(
        `${baseName}-sg`,
        {
          name: `${baseName}-sg-${stack}`,
          vpcId: vpc.vpcId,
          description: `${baseName} security group that is attached to the lambda`,
          tags,
        },
        { parent: this },
      );
      new aws.vpc.SecurityGroupIngressRule(
        `${baseName}-all-in`,
        {
          securityGroupId: lambdaSg.id,
          description: 'Allow all inbound',
          cidrIpv4: '0.0.0.0/0',
          ipProtocol: '-1',
          tags,
        },
        { parent: this },
      );
      new aws.vpc.SecurityGroupEgressRule(
        `${baseName}-all-out`,
        {
          securityGroupId: lambdaSg.id,
          description: 'Allow all outbound',
          cidrIpv4: '0.0.0.0/0',
          ipProtocol: '-1',
          tags,
        },
        { parent: this },
      );
    }

    const envVarsWithHash: { [key: string]: pulumi.Output<string> | string } = {
      ...envVars,
    };

    this.logGroup = new aws.cloudwatch.LogGroup(
      `${baseName}-log-group-${stack}`,
      {
        name: `/aws/lambda/${baseName}-${stack}`,
        retentionInDays: 7,
        tags,
      },
    );

    // Define the subscription filter
    new aws.cloudwatch.LogSubscriptionFilter(
      `${baseName}-log-subscription-filter`,
      {
        name: `${baseName}-${stack}`,
        logGroup: this.logGroup.name,
        destinationArn: DATADOG_KINESIS_FIREHOSE_STREAM_ARN,
        filterPattern: '{ $.* = "*" }',
        roleArn: CLOUDWATCH_KINESIS_STREAM_ROLE_ARN,
      },
    );

    this.lambda = new aws.lambda.Function(
      `${baseName}`,
      {
        loggingConfig: {
          logFormat: 'Text',
          logGroup: this.logGroup.name,
        },
        code: new pulumi.asset.FileArchive(zipLocation),
        name: `${baseName}-${stack}`,
        handler: 'bootstrap',
        runtime: 'provided.al2023',
        timeout: timeout ? timeout : 30,
        role: role.arn,
        memorySize,
        vpcConfig:
          vpc && lambdaSg
            ? {
                subnetIds: vpc.privateSubnetIds,
                securityGroupIds: [lambdaSg.id],
              }
            : undefined,
        environment: {
          variables: envVarsWithHash,
        },
        tags,
      },
      {
        parent: this,
      },
    );
  }
}
