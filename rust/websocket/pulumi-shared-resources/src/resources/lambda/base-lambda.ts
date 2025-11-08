import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import * as path from 'path';
import { get_coparse_api_vpc } from '../vpc';

export interface EnvVars {
  [key: string]: pulumi.Output<string> | string;
}

export interface VpcConfig {
  vpcId: string;
  publicSubnetIds: string[];
  privateSubnetIds: string[];
}

export abstract class BaseLambda<
  T extends EnvVars,
> extends pulumi.ComponentResource {
  public role: aws.iam.Role;

  protected readonly lambdaSg?: aws.ec2.SecurityGroup;
  protected readonly vpc?: VpcConfig;
  protected readonly handlerName: string;
  protected readonly baseName: string;
  protected readonly handlerBase: string;
  protected readonly envVars?: T;
  protected readonly stack: string;
  protected readonly additionalManagedPolicyArns: (
    | pulumi.Output<string>
    | string
  )[];

  constructor(
    type: string,
    name: string,
    args: {
      handlerName: string;
      baseName?: string;
      handlerBase: string;
      stack: string;
      envVars?: T;
      additionalManagedPolicyArns?: (pulumi.Output<string> | string)[];
      privateVpc?: boolean;
      registerAlarms?: boolean;
      alarmConfig?: {
        throttleThreshold?: number;
        errorThreshold?: number;
      };
    },
    opts?: pulumi.ResourceOptions,
  ) {
    super(type, name, {}, opts);

    this.handlerName = args.handlerName;
    this.baseName = args.baseName ?? `${this.handlerName}-lambda`;
    this.handlerBase = path.resolve(args.handlerBase);
    this.envVars = args.envVars;
    this.stack = args.stack;
    this.additionalManagedPolicyArns = args.additionalManagedPolicyArns ?? [];

    let vpc = undefined;
    if (args.privateVpc) {
      vpc = get_coparse_api_vpc();
    }
    this.vpc = vpc;

    let lambdaSg: aws.ec2.SecurityGroup | undefined;
    if (vpc) {
      lambdaSg = new aws.ec2.SecurityGroup(
        `${this.baseName}-sg-${this.stack}`,
        {
          name: `${this.baseName}-sg-${this.stack}`,
          vpcId: vpc.vpcId,
          description: `${this.baseName} security group that is attached to the lambda`,
        },
        { parent: this },
      );
      new aws.vpc.SecurityGroupIngressRule(
        `${this.baseName}-all-in-${this.stack}`,
        {
          securityGroupId: lambdaSg.id,
          description: 'Allow all inbound',
          cidrIpv4: '0.0.0.0/0',
          ipProtocol: '-1',
        },
        { parent: this },
      );
      new aws.vpc.SecurityGroupEgressRule(
        `${this.baseName}-all-out-${this.stack}`,
        {
          securityGroupId: lambdaSg.id,
          description: 'Allow all outbound',
          cidrIpv4: '0.0.0.0/0',
          ipProtocol: '-1',
        },
        { parent: this },
      );
    }
    this.lambdaSg = lambdaSg;

    this.role = this.getRole();
  }

  private getRole = (): aws.iam.Role => {
    const role = new aws.iam.Role(
      `${this.baseName}-role-${this.stack}`,
      {
        assumeRolePolicy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                Service: 'lambda.amazonaws.com',
              },
            },
          ],
        }),
        managedPolicyArns: [
          aws.iam.ManagedPolicies.AWSLambdaBasicExecutionRole,
          ...this.additionalManagedPolicyArns,
        ],
      },
      { parent: this },
    );
    return role;
  };

  protected abstract getLambda(): aws.lambda.Function;

  protected abstract registerAlarms({
    throttleThreshold,
    errorThreshold,
  }: {
    throttleThreshold?: number;
    errorThreshold?: number;
  }): {
    throttleAlarm: aws.cloudwatch.MetricAlarm;
    errorAlarm: aws.cloudwatch.MetricAlarm;
  };
}
