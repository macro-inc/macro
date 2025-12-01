import { Lambda } from '@lambda';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '@shared';

const LAMBA_BASE_NAME = 'search_upload_handler';
const CLOUD_STORAGE_BASE = `../../../rust/cloud-storage`;
const ZIP_LOCATION = `${CLOUD_STORAGE_BASE}/target/lambda/${LAMBA_BASE_NAME}/bootstrap.zip`;

type EnvVars = {
  ENVIRONMENT: pulumi.Output<string> | string;
  RUST_LOG: pulumi.Output<string> | string;
  SEARCH_EVENT_QUEUE: pulumi.Output<string> | string;
};

type Args = {
  envVars: EnvVars;
  searchEventQueueArn: pulumi.Output<string> | string;
  tags: { [key: string]: string };
};

export class SearchUploadHandler extends pulumi.ComponentResource {
  role: aws.iam.Role;
  lambda: aws.lambda.Function;
  tags: { [key: string]: string };
  constructor(
    name: string,
    args: Args,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:SearchUploadHandler', name, {}, opts);
    const { envVars, searchEventQueueArn, tags } = args;

    this.tags = tags;

    const sqsPolicy = new aws.iam.Policy(
      `${LAMBA_BASE_NAME}-sqs-policy`,
      {
        policy: pulumi.output({
          Version: '2012-10-17',
          Statement: [
            {
              Action: ['sqs:SendMessage'],
              Resource: [searchEventQueueArn],
              Effect: 'Allow',
            },
          ],
        }),
        tags: this.tags,
      },
      { parent: this }
    );

    this.role = new aws.iam.Role(
      `${LAMBA_BASE_NAME}-role`,
      {
        name: `${LAMBA_BASE_NAME}-role-${stack}`,
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
          aws.iam.ManagedPolicy.AWSLambdaRole,
          aws.iam.ManagedPolicy.CloudWatchLogsFullAccess,
          sqsPolicy.arn,
        ],
        tags: this.tags,
      },
      { parent: this }
    );

    const lambda = new Lambda<EnvVars>(
      `${LAMBA_BASE_NAME}-lambda`,
      {
        baseName: LAMBA_BASE_NAME,
        handlerBase: `${CLOUD_STORAGE_BASE}/${LAMBA_BASE_NAME}`,
        zipLocation: ZIP_LOCATION,
        envVars,
        role: this.role,
        reservedConcurrentExecutions: stack === 'prod' ? 500 : 50,
        tags: this.tags,
      },
      { parent: this }
    );

    this.lambda = lambda.lambda;

    this.setupLambdaAlarms();
  }

  setupLambdaAlarms() {
    new aws.cloudwatch.MetricAlarm(
      `${LAMBA_BASE_NAME}-throttle-alarm`,
      {
        name: `${LAMBA_BASE_NAME}-throttle-count-${stack}`,
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
        alarmDescription: `Alarm when ${LAMBA_BASE_NAME} lambda experiences throttling.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.cloudwatch.MetricAlarm(
      `${LAMBA_BASE_NAME}-error-alarm`,
      {
        name: `${LAMBA_BASE_NAME}-error-count-${stack}`,
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
        alarmDescription: `Alarm when ${LAMBA_BASE_NAME} lambda experiences errors.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this }
    );
  }
}
