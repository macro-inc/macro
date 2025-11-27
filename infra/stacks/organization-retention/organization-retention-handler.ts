import { Lambda } from '@lambda';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '@shared';

const LAMBA_BASE_NAME = 'organization_retention_handler';
const CLOUD_STORAGE_BASE = `../../../rust/cloud-storage`;
const ZIP_LOCATION = `${CLOUD_STORAGE_BASE}/target/lambda/${LAMBA_BASE_NAME}/bootstrap.zip`;

export type OrganizationRetentionhandlerEnvVars = {
  DATABASE_URL: pulumi.Output<string> | string;
  ENVIRONMENT: pulumi.Output<string> | string;
  RUST_LOG: pulumi.Output<string> | string;
  DOCUMENT_DELETE_QUEUE: pulumi.Output<string> | string;
  CHAT_DELETE_QUEUE: pulumi.Output<string> | string;
};

type OrganizationRetentionHandlerArgs = {
  envVars: OrganizationRetentionhandlerEnvVars;
  deleteDocumentQueueArn: pulumi.Output<string> | string;
  deleteChatQueueArn: pulumi.Output<string> | string;
  vpc: {
    vpcId: pulumi.Output<string> | string;
    publicSubnetIds: pulumi.Output<string[]> | string[];
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  tags: { [key: string]: string };
};

export class OrganizationRetentionHandler extends pulumi.ComponentResource {
  dlq: aws.sqs.Queue;
  queue: aws.sqs.Queue;
  role: aws.iam.Role;
  lambda: aws.lambda.Function;
  tags: { [key: string]: string };
  constructor(
    name: string,
    args: OrganizationRetentionHandlerArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:OrganizationRetentionHandler', name, {}, opts);
    const { deleteDocumentQueueArn, deleteChatQueueArn, vpc, envVars, tags } =
      args;

    this.tags = tags;

    // Create queue and DLQ
    this.dlq = new aws.sqs.Queue(
      `${LAMBA_BASE_NAME}-dlq-${stack}`,
      {
        name: `organization-retention-handler-dlq-${stack}`,
        messageRetentionSeconds: 1209600,
        tags,
      },
      { parent: this }
    );

    new aws.cloudwatch.MetricAlarm(
      'dlq-alarm',
      {
        name: `${LAMBA_BASE_NAME}-dlq-alarm-${stack}`,
        comparisonOperator: 'GreaterThanThreshold',
        evaluationPeriods: 1,
        metricName: 'ApproximateNumberOfMessagesVisible',
        namespace: 'AWS/SQS',
        period: 60,
        statistic: 'Average',
        threshold: 0,
        dimensions: {
          QueueName: this.dlq.name,
        },
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this }
    );

    this.queue = new aws.sqs.Queue(
      `${LAMBA_BASE_NAME}-queue-${stack}`,
      {
        name: `organization-retention-handler-queue-${stack}`,
        redrivePolicy: this.dlq.arn.apply((arn) =>
          JSON.stringify({
            deadLetterTargetArn: arn,
            maxReceiveCount: 5,
          })
        ),
        tags,
      },
      { parent: this, dependsOn: [this.dlq] }
    );

    const sqsPolicy = new aws.iam.Policy(
      `${LAMBA_BASE_NAME}-sqs-policy`,
      {
        policy: pulumi.output({
          Version: '2012-10-17',
          Statement: [
            {
              Action: [
                'sqs:ReceiveMessage',
                'sqs:DeleteMessage',
                'sqs:GetQueueAttributes',
              ],
              Resource: [this.queue.arn],
              Effect: 'Allow',
            },
          ],
        }),
        tags: this.tags,
      },
      { parent: this }
    );

    const sqsSendPolicy = new aws.iam.Policy(
      `${LAMBA_BASE_NAME}-sqs-send-policy`,
      {
        policy: pulumi.output({
          Version: '2012-10-17',
          Statement: [
            {
              Action: ['sqs:SendMessage'],
              Resource: [
                pulumi.interpolate`${deleteDocumentQueueArn}`,
                pulumi.interpolate`${deleteChatQueueArn}`,
              ],
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
          aws.iam.ManagedPolicy.AWSLambdaVPCAccessExecutionRole,
          aws.iam.ManagedPolicy.CloudWatchLogsFullAccess,
          sqsPolicy.arn,
          sqsSendPolicy.arn,
        ],
        tags: this.tags,
      },
      { parent: this }
    );

    const organizationRetentionhandlerLambda =
      new Lambda<OrganizationRetentionhandlerEnvVars>(
        `${LAMBA_BASE_NAME}-lambda`,
        {
          baseName: LAMBA_BASE_NAME,
          handlerBase: CLOUD_STORAGE_BASE,
          zipLocation: ZIP_LOCATION,
          vpc,
          envVars,
          role: this.role,
          timeout: 15,
          reservedConcurrentExecutions: 10, // handlered 1 time per day
          tags: this.tags,
        },
        { parent: this }
      );

    this.lambda = organizationRetentionhandlerLambda.lambda;

    new aws.lambda.Permission(
      'lambda-sqs-policy',
      {
        action: 'lambda:InvokeFunction',
        function: this.lambda.name,
        principal: 'sqs.amazonaws.com',
        sourceArn: this.queue.arn,
      },
      { parent: this }
    );

    new aws.lambda.EventSourceMapping(
      'lambda-sqs-mapping',
      {
        eventSourceArn: this.queue.arn,
        functionName: this.lambda.name,
        batchSize: 1,
      },
      { parent: this }
    );

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
