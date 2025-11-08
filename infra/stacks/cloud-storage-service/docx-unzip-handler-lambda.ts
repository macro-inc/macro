import { Lambda } from '@lambda';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '@shared';

const BASE_NAME = 'docx-unzip-lambda';
const CLOUD_STORAGE_BASE = '../../../';
const ZIP_LOCATION = `${CLOUD_STORAGE_BASE}/target/lambda/docx-unzip-handler/bootstrap.zip`;

export type DocxUnzipLambdaEnvVars = {
  DATABASE_URL: pulumi.Output<string> | string;
  REDIS_URI: pulumi.Output<string> | string;
  ENVIRONMENT: pulumi.Output<string> | string;
  RUST_LOG: pulumi.Output<string> | string;
  DOCUMENT_STORAGE_BUCKET: pulumi.Output<string> | string;
  DOCX_DOCUMENT_UPLOAD_BUCKET: pulumi.Output<string> | string;
  WEB_SOCKET_RESPONSE_LAMBDA: pulumi.Output<string> | string;
  CONVERT_QUEUE: pulumi.Output<string> | string;
};

type DocxUnzipHandlerLambdaArgs = {
  envVars: DocxUnzipLambdaEnvVars;
  docStorageBucketArn: pulumi.Output<string> | string;
  docxUploadBucketArn: pulumi.Output<string> | string;
  convertQueueArn: pulumi.Output<string> | string;
  jobUpdateHandlerLambdaArn: pulumi.Output<string> | string;
  vpc: {
    vpcId: pulumi.Output<string> | string;
    publicSubnetIds: pulumi.Output<string[]> | string[];
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  tags: { [key: string]: string };
};

export class DocxUnzipHandlerLambda extends pulumi.ComponentResource {
  role: aws.iam.Role;
  lambda: aws.lambda.Function;
  tags: { [key: string]: string };
  constructor(
    name: string,
    args: DocxUnzipHandlerLambdaArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:DocxUnzipHandlerLambda', name, {}, opts);
    const {
      docxUploadBucketArn,
      docStorageBucketArn,
      jobUpdateHandlerLambdaArn,
      convertQueueArn,
      vpc,
      envVars,
      tags,
    } = args;

    this.tags = tags;

    const s3Policy = new aws.iam.Policy(
      `${BASE_NAME}-s3-policy`,
      {
        policy: pulumi.output({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['s3:ListBucket', 's3:GetObject', 's3:PutObject'],
              Resource: [
                docStorageBucketArn,
                pulumi.interpolate`${docStorageBucketArn}/*`,
              ],
            },
            {
              Action: [
                's3:ListBucket',
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
              ],
              Resource: [
                docxUploadBucketArn,
                pulumi.interpolate`${docxUploadBucketArn}/*`,
              ],
              Effect: 'Allow',
            },
          ],
        }),
        tags: this.tags,
      },
      { parent: this }
    );

    const lambdaInvokePolicy = new aws.iam.Policy(
      `${BASE_NAME}-lambda-invoke-policy-${stack}`,
      {
        name: `${BASE_NAME}-lambda-invoke-policy-${stack}`,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: ['lambda:InvokeFunction'],
              Resource: [jobUpdateHandlerLambdaArn],
              Effect: 'Allow',
            },
          ],
        },
        tags: this.tags,
      },
      { parent: this }
    );

    const sqsPolicy = new aws.iam.Policy(
      `${BASE_NAME}-sqs-policy`,
      {
        policy: pulumi.output({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['sqs:SendMessage'],
              Resource: [convertQueueArn],
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
          aws.iam.ManagedPolicies.AWSLambdaBasicExecutionRole,
          aws.iam.ManagedPolicies.AWSLambdaRole,
          aws.iam.ManagedPolicies.AWSLambdaVPCAccessExecutionRole,
          aws.iam.ManagedPolicies.CloudWatchLogsFullAccess,
          s3Policy.arn,
          lambdaInvokePolicy.arn,
          sqsPolicy.arn,
        ],
        tags: this.tags,
      },
      { parent: this }
    );

    const docxUnzipLambda = new Lambda<DocxUnzipLambdaEnvVars>(
      `${BASE_NAME}-lambda`,
      {
        baseName: BASE_NAME,
        handlerBase: CLOUD_STORAGE_BASE,
        zipLocation: ZIP_LOCATION,
        vpc,
        envVars,
        role: this.role,
        // The > memory size = greater speedz
        memorySize: 256,
        tags: this.tags,
      },
      { parent: this }
    );

    this.lambda = docxUnzipLambda.lambda;

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
