import { Lambda } from '@lambda';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '@shared';

const LAMBDA_BASE_NAME = 'upload_extractor_lambda_trigger';
const CLOUD_STORAGE_BASE = `../../../`;
const ZIP_LOCATION = `${CLOUD_STORAGE_BASE}/target/lambda/${LAMBDA_BASE_NAME}/bootstrap.zip`;

export type UploadExtractorLambdaTriggerEnvVars = {
  DYNAMODB_TABLE: pulumi.Output<string> | string;
  UPLOAD_EXTRACTOR_QUEUE: pulumi.Output<string> | string;
  ENVIRONMENT: pulumi.Output<string> | string;
  RUST_LOG: pulumi.Output<string> | string;
};

export interface UploadExtractorLambdaTriggerArgs {
  envVars: UploadExtractorLambdaTriggerEnvVars;
  uploadExtractorQueueArn: pulumi.Output<string> | string;
  uploadBucketName: pulumi.Input<string>;
  tags: { [key: string]: string };
}

export class UploadExtractorLambdaTrigger extends pulumi.ComponentResource {
  lambda: aws.lambda.Function;
  tags: { [key: string]: string };

  constructor(
    name: string,
    args: UploadExtractorLambdaTriggerArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:UploadExtractorLambdaTrigger', name, {}, opts);
    const { uploadExtractorQueueArn, uploadBucketName, envVars, tags } = args;

    this.tags = tags;

    const sqsPolicy = new aws.iam.Policy(
      `${LAMBDA_BASE_NAME}-sqs-policy`,
      {
        policy: pulumi.output({
          Version: '2012-10-17',
          Statement: [
            {
              Action: ['sqs:SendMessage'],
              Resource: [pulumi.interpolate`${uploadExtractorQueueArn}`],
              Effect: 'Allow',
            },
          ],
        }),
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

    const uploadExtractorLambdaTriggerLambda =
      new Lambda<UploadExtractorLambdaTriggerEnvVars>(
        `${LAMBDA_BASE_NAME}-lambda`,
        {
          baseName: LAMBDA_BASE_NAME,
          handlerBase: CLOUD_STORAGE_BASE,
          zipLocation: ZIP_LOCATION,
          envVars,
          role: role,
          timeout: 5,
          tags: this.tags,
        },
        { parent: this }
      );

    this.lambda = uploadExtractorLambdaTriggerLambda.lambda;

    pulumi
      .all([uploadBucketName, uploadExtractorLambdaTriggerLambda.lambda.arn])
      .apply(([bucketName]) => {
        const triggerRule = new aws.cloudwatch.EventRule(
          `${LAMBDA_BASE_NAME}-event-rule`,
          {
            eventPattern: JSON.stringify({
              source: ['aws.s3'],
              'detail-type': ['Object Created'],
              detail: {
                bucket: {
                  name: [bucketName],
                },
                object: {
                  key: [
                    {
                      prefix: 'extract/',
                    },
                  ],
                },
              },
            }),
            description: 'Event rule for object uploads to the extract folder',
            tags: this.tags,
          },
          { parent: this }
        );

        new aws.cloudwatch.EventTarget(
          `${LAMBDA_BASE_NAME}-target-${stack}`,
          {
            rule: triggerRule.name,
            arn: this.lambda.arn,
          },
          { parent: this }
        );

        new aws.lambda.Permission(
          `${LAMBDA_BASE_NAME}-permission-${stack}`,
          {
            action: 'lambda:InvokeFunction',
            function: this.lambda.name,
            principal: 'events.amazonaws.com',
            sourceArn: triggerRule.arn,
          },
          { parent: this }
        );
      });

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
