import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import {
  CLOUDWATCH_KINESIS_STREAM_ROLE_ARN,
  DATADOG_KINESIS_FIREHOSE_STREAM_ARN,
  stack,
} from '@shared';
import { generateContentHash } from './hash';
import { SourceCodeHash } from './source_code_hash';

type LambdaArgs<T extends Record<string, any>> = {
  baseName: string;
  handlerBase: string;
  zipLocation: string;
  envVars?: { [K in keyof T]: pulumi.Output<string> | string };
  role: aws.iam.Role;
  vpc?: {
    vpcId: pulumi.Output<string> | string;
    publicSubnetIds: pulumi.Output<string[]> | string[];
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  timeout?: number;
  memorySize?: number;
  reservedConcurrentExecutions?: number;
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
      handlerBase,
      zipLocation,
      envVars,
      role,
      timeout,
      memorySize,
      reservedConcurrentExecutions,
      tags,
    }: LambdaArgs<T>,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super(`components:lambda:${baseName}`, name, {}, opts);
    let lambdaSg: aws.ec2.SecurityGroup | undefined;
    if (vpc) {
      lambdaSg = new aws.ec2.SecurityGroup(
        `${baseName}-sg-${stack}`,
        {
          name: `${baseName}-sg-${stack}`,
          vpcId: vpc.vpcId,
          description: `${baseName} security group that is attached to the lambda`,
          tags,
        },
        { parent: this }
      );
      new aws.vpc.SecurityGroupIngressRule(
        `${baseName}-all-in-${stack}`,
        {
          securityGroupId: lambdaSg.id,
          description: 'Allow all inbound',
          cidrIpv4: '0.0.0.0/0',
          ipProtocol: '-1',
          tags,
        },
        { parent: this }
      );
      new aws.vpc.SecurityGroupEgressRule(
        `${baseName}-all-out-${stack}`,
        {
          securityGroupId: lambdaSg.id,
          description: 'Allow all outbound',
          cidrIpv4: '0.0.0.0/0',
          ipProtocol: '-1',
          tags,
        },
        { parent: this }
      );
    }

    const sourceCodeFileHash = generateContentHash(handlerBase);
    const hashResource = new SourceCodeHash(
      `${baseName}-source-code-hash-${stack}`,
      { sourceCodeHash: sourceCodeFileHash },
      { parent: this }
    );

    const envVarsWithHash: { [key: string]: pulumi.Output<string> | string } = {
      ...envVars,
      SOURCE_CODE_FILE_HASH: sourceCodeFileHash,
    };

    this.logGroup = new aws.cloudwatch.LogGroup(
      `${baseName}-log-group-${stack}`,
      {
        name: `/aws/lambda/${baseName}-${stack}`,
        retentionInDays: 7,
        tags,
      }
      // TODO: uncommenting this will cause a ResourceAlreadyExistsException
      // you will need to manually delete the log group
      // { parent: this }
    );

    // Define the subscription filter
    new aws.cloudwatch.LogSubscriptionFilter(
      `${baseName}-log-subscription-filter`,
      {
        name: `${baseName}-${stack}`,
        logGroup: this.logGroup.name,
        destinationArn: DATADOG_KINESIS_FIREHOSE_STREAM_ARN,
        filterPattern:
          '- "START RequestId:" - "REPORT RequestId:" - "END RequestId:" - "INIT_START"',
        roleArn: CLOUDWATCH_KINESIS_STREAM_ROLE_ARN,
      }
      // TODO: uncommenting this will cause a ResourceAlreadyExistsException
      // you will need to manually delete the log group
      // { parent: this }
    );

    this.lambda = new aws.lambda.Function(
      `${baseName}-${stack}`,
      {
        loggingConfig: {
          logFormat: 'Text',
          logGroup: this.logGroup.name,
        },
        code: new pulumi.asset.FileArchive(zipLocation),
        name: `${baseName}-${stack}`,
        handler: 'bootstrap',
        runtime: 'provided.al2023',
        architectures: ['x86_64'],
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
        tags,
        reservedConcurrentExecutions,
        environment: {
          variables: envVarsWithHash,
        },
      },
      {
        parent: this,
        dependsOn: [hashResource], // this ensures the zip is updated with the new source code after a build
      }
    );
  }
}
