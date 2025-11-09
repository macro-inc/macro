import { Lambda } from '@lambda';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '@shared';

export const UPLOAD_EXTRACTOR_LAMBDA_TIMEOUT_SECONDS = 300;
const LAMBDA_BASE_NAME = 'upload_extractor_lambda_handler';
const CLOUD_STORAGE_BASE = `../../../rust/cloud-storage`;
const ZIP_LOCATION = `${CLOUD_STORAGE_BASE}/target/lambda/${LAMBDA_BASE_NAME}/bootstrap.zip`;

export type UploadExtractorLambdaHandlerEnvVars = {
  DYNAMODB_TABLE: pulumi.Output<string> | string;
  UPLOAD_BUCKET_NAME: pulumi.Output<string> | string;
  DSS_AUTH_KEY: pulumi.Output<string> | string;
  DSS_URL: pulumi.Output<string> | string;
  ENVIRONMENT: pulumi.Output<string> | string;
  RUST_LOG: pulumi.Output<string> | string;
  CONNECTION_GATEWAY_URL: pulumi.Output<string> | string;
};

export interface UploadExtractorLambdaHandlerArgs {
  envVars: UploadExtractorLambdaHandlerEnvVars;
  uploadExtractorQueueArn: pulumi.Output<string> | string;
  uploadBucketArn: pulumi.Input<string>;
  tags: { [key: string]: string };
}

export class UploadExtractorLambdaHandler extends pulumi.ComponentResource {
  lambda: aws.lambda.Function;
  role: aws.iam.Role;
  tags: { [key: string]: string };

  constructor(
    name: string,
    args: UploadExtractorLambdaHandlerArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:UploadExtractorLambdaHandler', name, {}, opts);
    const { uploadExtractorQueueArn, uploadBucketArn, envVars, tags } = args;

    this.tags = tags;

    const sqsPolicy = new aws.iam.Policy(
      `${LAMBDA_BASE_NAME}-sqs-policy`,
      {
        policy: pulumi.output({
          Version: '2012-10-17',
          Statement: [
            {
              Action: [
                'sqs:ReceiveMessage',
                'sqs:GetQueueAttributes',
                'sqs:DeleteMessage',
              ],
              Resource: [pulumi.interpolate`${uploadExtractorQueueArn}`],
              Effect: 'Allow',
            },
          ],
        }),
        tags: this.tags,
      },
      { parent: this }
    );

    const uploadBucketPolicy = new aws.iam.Policy(
      `${LAMBDA_BASE_NAME}-upload-bucket-policy`,
      {
        name: `${LAMBDA_BASE_NAME}-upload-bucket-policy-${stack}`,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: ['s3:GetObject'],
              Resource: [
                uploadBucketArn,
                pulumi.interpolate`${uploadBucketArn}/*`,
              ],
              Effect: 'Allow',
            },
          ],
        },
        tags: this.tags,
      },
      { parent: this }
    );

    const role = new aws.iam.Role(
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
          aws.iam.ManagedPolicy.AmazonDynamoDBFullAccess,
          sqsPolicy.arn,
        ],
        tags: this.tags,
      },
      { parent: this }
    );

    const uploadExtractorLambdaHandlerLambda =
      new Lambda<UploadExtractorLambdaHandlerEnvVars>(
        `${LAMBDA_BASE_NAME}-lambda`,
        {
          baseName: LAMBDA_BASE_NAME,
          handlerBase: CLOUD_STORAGE_BASE,
          zipLocation: ZIP_LOCATION,
          envVars,
          role: role,
          timeout: UPLOAD_EXTRACTOR_LAMBDA_TIMEOUT_SECONDS,
          memorySize: stack === 'prod' ? 2048 : 1024,
          tags: this.tags,
        },
        { parent: this }
      );

    this.lambda = uploadExtractorLambdaHandlerLambda.lambda;
    this.role = role;

    new aws.iam.RolePolicyAttachment(
      `${LAMBDA_BASE_NAME}-role-upload-bucket-att`,
      {
        role,
        policyArn: uploadBucketPolicy.arn,
      },
      { parent: this, dependsOn: [uploadBucketPolicy, role] }
    );

    new aws.lambda.Permission(
      `${LAMBDA_BASE_NAME}-sqs-permission-${stack}`,
      {
        action: 'lambda:InvokeFunction',
        function: this.lambda.name,
        principal: 'sqs.amazonaws.com',
        sourceArn: uploadExtractorQueueArn,
      },
      { parent: this }
    );

    new aws.lambda.EventSourceMapping(
      `${LAMBDA_BASE_NAME}-sqs-source-mapping`,
      {
        eventSourceArn: uploadExtractorQueueArn,
        functionName: this.lambda.name,
        batchSize: 1, // you can increase this if your handler can handle batches
        enabled: true,
      },
      { parent: this }
    );

    this.setupLambdaAlarms();
  }

  setupLambdaAlarms() {
    new aws.cloudwatch.MetricAlarm(
      `${LAMBDA_BASE_NAME}-throttle-alarm`,
      {
        name: `${LAMBDA_BASE_NAME}-throttle-count-${stack}`,
        metricName: 'Throttles',
        namespace: 'AWS/Lambda',
        statistic: 'Sum',
        period: 300,
        evaluationPeriods: 1,
        threshold: 50,
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
