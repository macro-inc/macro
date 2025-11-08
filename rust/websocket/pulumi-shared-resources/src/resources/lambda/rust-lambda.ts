import { BaseLambda, EnvVars } from './base-lambda';
import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { generateContentHash } from '../../utils/hash';
import { SourceCodeHash } from './source-code-hash-provider';
import { CLOUD_TRAIL_SNS_TOPIC_ARN } from '../account';

export class RustLambda<T extends EnvVars> extends BaseLambda<T> {
  public readonly lambda: aws.lambda.Function;

  private readonly zipLocation: string;
  private readonly buildFn: () => void;
  private readonly tags: { [key: string]: string };
  private readonly loggingConfig?: {
    logFormat: string;
    logGroup: pulumi.Output<string>;
  };

  constructor(
    name: string,
    args: {
      handlerName: string;
      handlerBase: string;
      stack: string;
      envVars?: T;
      additionalManagedPolicyArns?: (pulumi.Output<string> | string)[];
      privateVpc?: boolean;
      prebuildCommand?: string;
      buildCommand?: string;
      skipBuild?: boolean;
      zipLocation?: string;
      registerAlarms?: boolean;
      alarmConfig?: {
        throttleThreshold?: number;
        errorThreshold?: number;
      };
      loggingConfig?: {
        logFormat: string;
        logGroup: pulumi.Output<string>;
      };
      tags: { [key: string]: string };
    },
    opts?: pulumi.ResourceOptions,
  ) {
    super('custom:resource:RustLambda', name, { ...args }, opts);
    this.tags = args.tags;
    this.loggingConfig = args.loggingConfig;

    const handlerBase = path.resolve(args.handlerBase);
    const zipLocation =
      args.zipLocation ??
      `${handlerBase}/target/lambda/${args.handlerName}/bootstrap.zip`;

    if (args.prebuildCommand) {
      execSync(args.prebuildCommand, {
        cwd: handlerBase,
        stdio: 'inherit',
      });
    }

    if (args.skipBuild !== true) {
      this.buildFn = () =>
        execSync(args.buildCommand ?? 'make build', {
          cwd: handlerBase,
          stdio: 'pipe',
        });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      this.buildFn = () => {};
    }

    this.zipLocation = zipLocation;

    this.lambda = this.getLambda();

    if (args.registerAlarms) {
      if (!args.alarmConfig) {
        throw new Error(
          'Alarm configuration is required when registering alarms',
        );
      }
      this.registerAlarms({
        throttleThreshold: args.alarmConfig.throttleThreshold,
        errorThreshold: args.alarmConfig.errorThreshold,
      });
    }

    this.registerOutputs({
      lambda: this.lambda,
      role: this.role,
    });
  }

  protected registerAlarms({
    throttleThreshold,
    errorThreshold,
  }: {
    throttleThreshold?: number;
    errorThreshold?: number;
  }) {
    const throttleAlarm = new aws.cloudwatch.MetricAlarm(
      `${this.baseName}-throttle-alarm-${this.stack}`,
      {
        name: `${this.baseName}-throttle-count`,
        metricName: 'Throttles',
        namespace: 'AWS/Lambda',
        statistic: 'Sum',
        period: 300,
        evaluationPeriods: 1,
        threshold: throttleThreshold ?? 1,
        comparisonOperator: 'GreaterThanOrEqualToThreshold',
        dimensions: {
          FunctionName: this.lambda.name,
        },
        alarmDescription: `Alarm when ${this.baseName} lambda experiences throttling.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this },
    );

    const errorAlarm = new aws.cloudwatch.MetricAlarm(
      `${this.baseName}-error-alarm`,
      {
        name: `${this.baseName}-error-count-${this.stack}`,
        metricName: 'Errors',
        namespace: 'AWS/Lambda',
        statistic: 'Sum',
        period: 300,
        evaluationPeriods: 1,
        threshold: errorThreshold ?? 1,
        comparisonOperator: 'GreaterThanOrEqualToThreshold',
        dimensions: {
          FunctionName: this.lambda.name,
        },
        alarmDescription: `Alarm when ${this.baseName} lambda experiences errors.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this },
    );
    return { throttleAlarm, errorAlarm };
  }

  protected getLambda = (): aws.lambda.Function => {
    if (!fs.existsSync(this.zipLocation)) {
      this.buildFn();
    }
    const sourceCodeFileHash = this.generateHash(this.handlerBase);

    const hashResource = new SourceCodeHash(
      `${this.baseName}-source-code-hash-${this.stack}`,
      this.buildFn,
      { sourceCodeHash: sourceCodeFileHash },
      { parent: this },
    );

    // not strictly necessary, but it's nice to have to uniquely identify the lambda
    const envVarsWithHash = {
      ...this.envVars,
      SOURCE_CODE_FILE_HASH: sourceCodeFileHash,
    };

    return new aws.lambda.Function(
      `${this.baseName}-${this.stack}`,
      {
        loggingConfig: this.loggingConfig,
        code: new pulumi.asset.FileArchive(this.zipLocation),
        name: `${this.baseName}-${this.stack}`,
        handler: 'bootstrap',
        runtime: 'provided.al2023',
        timeout: 30,
        role: this.role.arn,
        environment: {
          variables: envVarsWithHash,
        },
        vpcConfig:
          this.vpc && this.lambdaSg
            ? {
                subnetIds: this.vpc.privateSubnetIds,
                securityGroupIds: [this.lambdaSg.id],
              }
            : undefined,
        tags: this.tags,
      },
      { dependsOn: [hashResource], parent: this },
    );
  };

  private generateHash(basePath: string): string {
    return generateContentHash(basePath);
  }
}
