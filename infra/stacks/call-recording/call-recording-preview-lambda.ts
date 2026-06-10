import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Lambda } from '../../packages/lambda';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '../../packages/shared';

const LAMBDA_BASE_NAME = 'call_recording_preview_handler';
const CLOUD_STORAGE_BASE = `../../../rust/cloud-storage`;
const ZIP_LOCATION = `${CLOUD_STORAGE_BASE}/target/lambda/${LAMBDA_BASE_NAME}/bootstrap.zip`;
const FFMPEG_LAYER_ZIP_LOCATION = `${CLOUD_STORAGE_BASE}/target/lambda/${LAMBDA_BASE_NAME}/ffmpeg-layer.zip`;
const FFMPEG_LAYER_ARTIFACT_BUCKET_NAME = `macro-call-recording-preview-layer-artifacts-${stack}`;

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

function fileBase64Sha256(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `FFmpeg Lambda layer zip not found at ${filePath}. Run \`just call_recording_preview_handler/build\` from rust/cloud-storage before deploying.`
    );
  }

  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('base64');
}

export class CallRecordingPreviewLambda extends pulumi.ComponentResource {
  role: aws.iam.Role;
  lambda: aws.lambda.Function;
  ffmpegLayer: aws.lambda.LayerVersion;
  tags: { [key: string]: string };

  constructor(
    name: string,
    args: CallRecordingPreviewLambdaArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:CallRecordingPreviewLambda', name, {}, opts);
    const { callRecordingBucketArn, vpc, envVars, tags } = args;

    this.tags = tags;

    const ffmpegLayerSourceCodeHash = fileBase64Sha256(
      FFMPEG_LAYER_ZIP_LOCATION
    );

    const ffmpegLayerArtifactBucket = new aws.s3.BucketV2(
      `${LAMBDA_BASE_NAME}-ffmpeg-layer-artifacts-${stack}`,
      {
        bucket: FFMPEG_LAYER_ARTIFACT_BUCKET_NAME,
        forceDestroy: stack !== 'prod',
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.s3.BucketPublicAccessBlock(
      `${LAMBDA_BASE_NAME}-ffmpeg-layer-artifacts-public-access-block-${stack}`,
      {
        bucket: ffmpegLayerArtifactBucket.id,
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      },
      { parent: this, dependsOn: [ffmpegLayerArtifactBucket] }
    );

    const ffmpegLayerObject = new aws.s3.BucketObjectv2(
      `${LAMBDA_BASE_NAME}-ffmpeg-layer-zip-${stack}`,
      {
        bucket: ffmpegLayerArtifactBucket.id,
        key: `${LAMBDA_BASE_NAME}/ffmpeg-layer.zip`,
        source: new pulumi.asset.FileAsset(FFMPEG_LAYER_ZIP_LOCATION),
        sourceHash: ffmpegLayerSourceCodeHash,
        contentType: 'application/zip',
        serverSideEncryption: 'AES256',
        tags: this.tags,
      },
      { parent: this, dependsOn: [ffmpegLayerArtifactBucket] }
    );

    this.ffmpegLayer = new aws.lambda.LayerVersion(
      `${LAMBDA_BASE_NAME}-ffmpeg-layer-${stack}`,
      {
        layerName: `${LAMBDA_BASE_NAME}-ffmpeg-${stack}`,
        description:
          'Static ffmpeg and ffprobe binaries for call recording preview generation.',
        compatibleArchitectures: ['x86_64'],
        compatibleRuntimes: ['provided.al2023'],
        s3Bucket: ffmpegLayerArtifactBucket.id,
        s3Key: ffmpegLayerObject.key,
        sourceCodeHash: ffmpegLayerSourceCodeHash,
      },
      { parent: this, dependsOn: [ffmpegLayerObject] }
    );

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
        layers: [this.ffmpegLayer.arn],
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
