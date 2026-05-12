import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Lambda } from '../../packages/lambda';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '../../packages/shared';

const BASE_NAME = 'document-upload-finalizer-lambda';
const CLOUD_STORAGE_BASE = `../../../rust/cloud-storage`;
const ZIP_FOLDER_NAME = 'document_upload_finalizer_handler';
const ZIP_LOCATION = `${CLOUD_STORAGE_BASE}/target/lambda/${ZIP_FOLDER_NAME}/bootstrap.zip`;

export type DocumentUploadFinalizerLambdaEnvVars = {
  DATABASE_URL: pulumi.Output<string> | string;
  INTERNAL_API_SECRET_KEY: pulumi.Output<string> | string;
  SYNC_SERVICE_AUTH_KEY: pulumi.Output<string> | string;
  LEXICAL_SERVICE_URL: pulumi.Output<string> | string;
  SYNC_SERVICE_URL: pulumi.Output<string> | string;
  RUST_LOG: pulumi.Output<string> | string;
};

type DocumentUploadFinalizerLambdaArgs = {
  envVars: DocumentUploadFinalizerLambdaEnvVars;
  documentStorageBucketArn: pulumi.Output<string> | string;
  vpc: {
    vpcId: pulumi.Output<string> | string;
    publicSubnetIds: pulumi.Output<string[]> | string[];
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  tags: { [key: string]: string };
};

export class DocumentUploadFinalizerLambda extends pulumi.ComponentResource {
  role: aws.iam.Role;
  lambda: aws.lambda.Function;
  tags: { [key: string]: string };

  constructor(
    name: string,
    args: DocumentUploadFinalizerLambdaArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:DocumentUploadFinalizerLambda', name, {}, opts);
    const { documentStorageBucketArn, vpc, envVars, tags } = args;

    this.tags = tags;

    const s3Policy = new aws.iam.Policy(
      `${BASE_NAME}-s3-policy`,
      {
        name: `${BASE_NAME}-s3-policy-${stack}`,
        policy: pulumi.output({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['s3:GetObject'],
              Resource: [pulumi.interpolate`${documentStorageBucketArn}/*`],
            },
          ],
        }),
        tags: this.tags,
      },
      { parent: this }
    );

    this.role = new aws.iam.Role(
      `${BASE_NAME}-role`,
      {
        name: `${BASE_NAME}-role-${stack}`,
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
          aws.iam.ManagedPolicy.CloudWatchLogsFullAccess,
          s3Policy.arn,
        ],
        tags: this.tags,
      },
      { parent: this }
    );

    const lambda = new Lambda<DocumentUploadFinalizerLambdaEnvVars>(
      `${BASE_NAME}-lambda`,
      {
        baseName: BASE_NAME,
        handlerBase: CLOUD_STORAGE_BASE,
        zipLocation: ZIP_LOCATION,
        vpc,
        envVars,
        role: this.role,
        timeout: 60,
        memorySize: 512,
        tags: this.tags,
      },
      { parent: this }
    );

    this.lambda = lambda.lambda;

    this.setupLambdaAlarms();
  }

  setupLambdaAlarms() {
    new aws.cloudwatch.MetricAlarm(
      `${BASE_NAME}-throttle-alarm`,
      {
        name: `${BASE_NAME}-throttle-count-${stack}`,
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
        alarmDescription: `Alarm when ${BASE_NAME} lambda experiences throttling.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.cloudwatch.MetricAlarm(
      `${BASE_NAME}-error-alarm`,
      {
        name: `${BASE_NAME}-error-count-${stack}`,
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
        alarmDescription: `Alarm when ${BASE_NAME} lambda experiences errors.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this }
    );
  }
}
