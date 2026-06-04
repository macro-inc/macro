import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Lambda } from '../../packages/lambda';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '../../packages/shared';

const LAMBDA_BASE_NAME = 'call_recording_preview_handler';
const CLOUD_STORAGE_BASE = `../../../rust/cloud-storage`;
const ZIP_LOCATION = `${CLOUD_STORAGE_BASE}/target/lambda/${LAMBDA_BASE_NAME}/bootstrap.zip`;

export type CallRecordingPreviewLambdaEnvVars = {
  CALL_RECORDING_BUCKET_NAME: pulumi.Output<string> | string;
  DATABASE_URL: pulumi.Output<string> | string;
  ENVIRONMENT: pulumi.Output<string> | string;
  FFMPEG_PATH: pulumi.Output<string> | string;
  FFPROBE_PATH: pulumi.Output<string> | string;
  RUST_LOG: pulumi.Output<string> | string;
};

type VpcArgs = {
  vpcId: pulumi.Output<string> | string;
  publicSubnetIds: pulumi.Output<string[]> | string[];
  privateSubnetIds: pulumi.Output<string[]> | string[];
};

type CallRecordingPreviewLambdaArgs = {
  envVars: CallRecordingPreviewLambdaEnvVars;
  callRecordingBucketArn: pulumi.Output<string> | string;
  vpc: VpcArgs;
  tags: { [key: string]: string };
};

export class CallRecordingPreviewLambda extends pulumi.ComponentResource {
  role: aws.iam.Role;
  lambda: aws.lambda.Function;
  tags: { [key: string]: string };

  constructor(
    name: string,
    args: CallRecordingPreviewLambdaArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:CallRecordingPreviewLambda', name, {}, opts);
    const { callRecordingBucketArn, vpc, envVars, tags } = args;

    this.tags = tags;

    const s3Policy = new aws.iam.Policy(
      `${LAMBDA_BASE_NAME}-s3-policy`,
      {
        name: `${LAMBDA_BASE_NAME}-s3-policy-${stack}`,
        policy: pulumi.output({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['s3:GetObject'],
              Resource: [
                pulumi.interpolate`${callRecordingBucketArn}/calls/*.mp4`,
              ],
            },
            {
              Effect: 'Allow',
              Action: ['s3:PutObject'],
              Resource: [
                pulumi.interpolate`${callRecordingBucketArn}/calls/*/PREVIEW.jpg`,
              ],
            },
          ],
        }),
        tags: this.tags,
      },
      { parent: this }
    );

    this.role = new aws.iam.Role(
      `${LAMBDA_BASE_NAME}-role`,
      {
        name: `${LAMBDA_BASE_NAME}-role-${stack}`,
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
          aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
          aws.iam.ManagedPolicy.AWSLambdaVPCAccessExecutionRole,
          s3Policy.arn,
        ],
        tags: { ...this.tags, 'call-recording-access': 'true' },
      },
      { parent: this, dependsOn: [s3Policy] }
    );

    const previewLambda = new Lambda<CallRecordingPreviewLambdaEnvVars>(
      `${LAMBDA_BASE_NAME}-lambda`,
      {
        baseName: LAMBDA_BASE_NAME,
        handlerBase: CLOUD_STORAGE_BASE,
        zipLocation: ZIP_LOCATION,
        envVars,
        role: this.role,
        vpc,
        timeout: 300,
        memorySize: stack === 'prod' ? 2048 : 1024,
        tags: this.tags,
      },
      { parent: this }
    );

    this.lambda = previewLambda.lambda;

    this.setupLambdaAlarms();
  }

  setupLambdaAlarms(): void {
    new aws.cloudwatch.MetricAlarm(
      `${LAMBDA_BASE_NAME}-throttle-alarm`,
      {
        name: `${LAMBDA_BASE_NAME}-throttle-count-${stack}`,
        metricName: 'Throttles',
        namespace: 'AWS/Lambda',
        statistic: 'Sum',
        period: 300,
        evaluationPeriods: 1,
        threshold: 1,
        comparisonOperator: 'GreaterThanOrEqualToThreshold',
        dimensions: {
          FunctionName: this.lambda.name,
        },
        alarmDescription: `Alarm when ${LAMBDA_BASE_NAME} lambda experiences throttling.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.cloudwatch.MetricAlarm(
      `${LAMBDA_BASE_NAME}-error-alarm`,
      {
        name: `${LAMBDA_BASE_NAME}-error-count-${stack}`,
        metricName: 'Errors',
        namespace: 'AWS/Lambda',
        statistic: 'Sum',
        period: 300,
        evaluationPeriods: 1,
        threshold: 1,
        comparisonOperator: 'GreaterThanOrEqualToThreshold',
        dimensions: {
          FunctionName: this.lambda.name,
        },
        alarmDescription: `Alarm when ${LAMBDA_BASE_NAME} lambda experiences errors.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this }
    );
  }
}
