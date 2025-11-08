import { BaseLambda, EnvVars } from './base-lambda';
import * as pulumi from '@pulumi/pulumi';
import * as archive from '@pulumi/archive';
import * as aws from '@pulumi/aws';
import * as path from 'path';
import { execSync } from 'child_process';
import { CLOUD_TRAIL_SNS_TOPIC_ARN } from '../account';

export class PythonLambda<T extends EnvVars> extends BaseLambda<T> {
  private static readonly DEFAULT_LAMBDA_TIMEOUT = 3;
  public readonly lambda: aws.lambda.Function;

  private readonly handlerEntrypoint: string;
  private readonly preInstall?: () => void;
  private readonly archivePath?: string;
  private readonly timeout?: number;
  private readonly tags: { [key: string]: string };

  constructor(
    name: string,
    args: {
      handlerName: string;
      baseName?: string;
      handlerBase: string;
      handlerEntrypoint: string;
      stack: string;
      envVars?: T;
      additionalManagedPolicyArns?: (pulumi.Output<string> | string)[];
      privateVpc?: boolean;
      registerAlarms?: boolean;
      alarmConfig?: {
        throttleThreshold?: number;
        errorThreshold?: number;
      };
      preInstallOverride?: () => void;
      archivePath?: string;
      timeout?: number;
      tags: { [key: string]: string };
    },
    opts?: pulumi.ResourceOptions,
  ) {
    super('custom:resource:PythonLambda', name, { ...args }, opts);
    this.tags = args.tags;

    this.handlerEntrypoint = args.handlerEntrypoint;
    this.preInstall =
      args.preInstallOverride ??
      (() => this.preInstallDefault(args.handlerBase));
    this.archivePath = args.archivePath;

    this.timeout = args?.timeout ?? PythonLambda.DEFAULT_LAMBDA_TIMEOUT;
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

  private preInstallDefault = (cwdPath: string): void => {
    console.log(`Installing at handler base directory: ${cwdPath}`);
    execSync('make build', {
      cwd: cwdPath,
      stdio: 'pipe',
    });
  };

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
    this.preInstall?.();
    const outputPath = path.resolve(
      this.handlerBase,
      `../outputs/${this.handlerName}.zip`,
    );
    const zipFile = archive.getFile({
      outputFileMode: '0666',
      type: 'zip',
      sourceDir: this.handlerBase,
      outputPath: outputPath,
    });
    const zipPath = this.archivePath ?? zipFile.then(f => f.outputPath);

    return new aws.lambda.Function(
      `${this.baseName}-${this.stack}`,
      {
        runtime: aws.lambda.Runtime.Python3d9,
        name: this.handlerName,
        code: new pulumi.asset.FileArchive(zipPath),
        handler: this.handlerEntrypoint,
        role: this.role.arn,
        environment: this.envVars && {
          variables: this.envVars,
        },
        vpcConfig:
          this.vpc && this.lambdaSg
            ? {
              subnetIds: this.vpc.privateSubnetIds,
              securityGroupIds: [this.lambdaSg.id],
            }
            : undefined,
        timeout: this.timeout,
        tags: this.tags,
      },
      { parent: this },
    );
  };
}
