import { BaseLambda, EnvVars } from './base-lambda';
import * as pulumi from '@pulumi/pulumi';
import * as archive from '@pulumi/archive';
import * as aws from '@pulumi/aws';
import * as path from 'path';
import { execSync } from 'child_process';
import { CLOUD_TRAIL_SNS_TOPIC_ARN } from '../account';

export class JavascriptLambda<T extends EnvVars> extends BaseLambda<T> {
  public readonly lambda: aws.lambda.Function;

  private readonly handlerEntrypoint: string;
  private readonly zipLocation?: string;
  private readonly EXCLUDE_FILES = [
    'package-lock.json',
    'node_modules/.bin',
    'node_modules/.cache',
    'node_modules/.package-lock.json',
  ];

  private readonly preInstall?: () => void;
  private readonly tags: { [key: string]: string };
  private readonly loggingConfig?: {
    logFormat: string;
    logGroup: pulumi.Output<string>;
  };

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
      loggingConfig?: {
        logFormat: string;
        logGroup: pulumi.Output<string>;
      };
      tags: { [key: string]: string };
      preInstallOverride?: () => void;
      zipLocation?: string;
    },
    opts?: pulumi.ResourceOptions,
  ) {
    super('custom:resource:JsLambda', name, { ...args }, opts);

    this.tags = args.tags;
    this.loggingConfig = args.loggingConfig;
    this.zipLocation = args.zipLocation;

    this.handlerEntrypoint = args.handlerEntrypoint;
    this.preInstall =
      args.preInstallOverride ??
      (() => this.preInstallDefault(args.handlerBase));

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

  private preInstallDefault = (cwdPath: string): void => {
    console.log(`Installing at handler base directory: ${cwdPath}`);
    execSync('npm install', {
      cwd: cwdPath,
      stdio: 'pipe',
    });
  };

  protected getLambda = (): aws.lambda.Function => {
    let code: pulumi.asset.Archive;

    if (this.zipLocation) {
      code = new pulumi.asset.FileArchive(this.zipLocation);
    } else {
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
        excludes: this.EXCLUDE_FILES,
      });
      code = new pulumi.asset.FileArchive(zipFile.then(f => f.outputPath));
    }

    return new aws.lambda.Function(
      `${this.baseName}-${this.stack}`,
      {
        loggingConfig: this.loggingConfig,
        runtime: aws.lambda.Runtime.NodeJS20dX,
        name: this.handlerName,
        code,
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
        tags: this.tags,
      },
      { parent: this },
    );
  };
}
