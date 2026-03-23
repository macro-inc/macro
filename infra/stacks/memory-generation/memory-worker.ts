import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Lambda } from '../../packages/lambda';
import { QueueAlarms } from '../../packages/resources';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '../../packages/shared';

const LAMBDA_BASE_NAME = 'memory_worker';
const CLOUD_STORAGE_BASE = `../../../rust/cloud-storage`;
const ZIP_LOCATION = `${CLOUD_STORAGE_BASE}/target/lambda/${LAMBDA_BASE_NAME}/bootstrap.zip`;

export type MemoryWorkerEnvVars = {
  DATABASE_URL: pulumi.Output<string> | string;
  ANTHROPIC_API_KEY: pulumi.Output<string> | string;
  OPEN_ROUTER_API_KEY: pulumi.Output<string> | string;
  INTERNAL_API_SECRET_KEY: pulumi.Output<string> | string;
  DOCUMENT_STORAGE_SERVICE_URL: pulumi.Output<string> | string;
  SEARCH_SERVICE_URL: pulumi.Output<string> | string;
  EMAIL_SERVICE_URL: pulumi.Output<string> | string;
  SYNC_SERVICE_URL: pulumi.Output<string> | string;
  DOCUMENT_COGNITION_SERVICE_URL: pulumi.Output<string> | string;
  STATIC_FILE_SERVICE_URL: pulumi.Output<string> | string;
  COMMS_SERVICE_URL: pulumi.Output<string> | string;
  LEXICAL_SERVICE_URL: pulumi.Output<string> | string;
  DOCUMENT_STORAGE_BUCKET: pulumi.Output<string> | string;
  DOCX_DOCUMENT_UPLOAD_BUCKET: pulumi.Output<string> | string;
  DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL: pulumi.Output<string> | string;
  DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID: pulumi.Output<string> | string;
  DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME: pulumi.Output<string> | string;
  ENVIRONMENT: pulumi.Output<string> | string;
  RUST_LOG: pulumi.Output<string> | string;
};

type MemoryWorkerArgs = {
  envVars: MemoryWorkerEnvVars;
  vpc: {
    vpcId: pulumi.Output<string> | string;
    publicSubnetIds: pulumi.Output<string[]> | string[];
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  bucketArns: (pulumi.Output<string> | string)[];
  tags: { [key: string]: string };
};

export class MemoryWorker extends pulumi.ComponentResource {
  queue: aws.sqs.Queue;
  dlq: aws.sqs.Queue;
  role: aws.iam.Role;
  lambda: aws.lambda.Function;
  tags: { [key: string]: string };

  constructor(
    name: string,
    args: MemoryWorkerArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:MemoryWorker', name, {}, opts);
    const { vpc, envVars, bucketArns, tags } = args;

    this.tags = tags;

    // DLQ
    this.dlq = new aws.sqs.Queue(
      `${LAMBDA_BASE_NAME}-dlq`,
      {
        name: `${LAMBDA_BASE_NAME}-dlq-${stack}`,
        messageRetentionSeconds: 1209600, // 14 days
        tags,
      },
      { parent: this }
    );

    new aws.cloudwatch.MetricAlarm(
      `${LAMBDA_BASE_NAME}-dlq-alarm`,
      {
        name: `${LAMBDA_BASE_NAME}-dlq-alarm-${stack}`,
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

    // Main queue — long visibility timeout for AI generation (20 min)
    this.queue = new aws.sqs.Queue(
      `${LAMBDA_BASE_NAME}-queue`,
      {
        name: `memory-generation-queue-${stack}`,
        visibilityTimeoutSeconds: 1200, // 20 minutes
        messageRetentionSeconds: 86400, // 1 day
        redrivePolicy: this.dlq.arn.apply((arn) =>
          JSON.stringify({
            deadLetterTargetArn: arn,
            maxReceiveCount: 2,
          })
        ),
        tags,
      },
      { parent: this, dependsOn: [this.dlq] }
    );

    new QueueAlarms(
      `${LAMBDA_BASE_NAME}-queue-alarms`,
      { queue: this.queue, tags },
      { parent: this }
    );

    // IAM policies
    const sqsPolicy = new aws.iam.Policy(
      `${LAMBDA_BASE_NAME}-sqs-policy`,
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

    const s3Policy = new aws.iam.Policy(
      `${LAMBDA_BASE_NAME}-s3-policy`,
      {
        policy: pulumi.output({
          Version: '2012-10-17',
          Statement: [
            {
              Action: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
              Resource: bucketArns.flatMap((arn) => [
                pulumi.interpolate`${arn}`,
                pulumi.interpolate`${arn}/*`,
              ]),
              Effect: 'Allow',
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
          aws.iam.ManagedPolicy.AWSLambdaRole,
          aws.iam.ManagedPolicy.AWSLambdaVPCAccessExecutionRole,
          aws.iam.ManagedPolicy.CloudWatchLogsFullAccess,
          sqsPolicy.arn,
          s3Policy.arn,
        ],
        tags: this.tags,
      },
      { parent: this }
    );

    // Lambda — 15 min timeout for AI tool loop
    const workerLambda = new Lambda<MemoryWorkerEnvVars>(
      `${LAMBDA_BASE_NAME}-lambda`,
      {
        baseName: LAMBDA_BASE_NAME,
        handlerBase: CLOUD_STORAGE_BASE,
        zipLocation: ZIP_LOCATION,
        vpc,
        envVars,
        role: this.role,
        memorySize: 512,
        timeout: 900, // 15 minutes
        reservedConcurrentExecutions: stack === 'prod' ? 10 : 2,
        tags: this.tags,
      },
      { parent: this }
    );

    this.lambda = workerLambda.lambda;

    // Connect SQS to Lambda
    new aws.lambda.Permission(
      `${LAMBDA_BASE_NAME}-sqs-permission`,
      {
        action: 'lambda:InvokeFunction',
        function: this.lambda.name,
        principal: 'sqs.amazonaws.com',
        sourceArn: this.queue.arn,
      },
      { parent: this }
    );

    new aws.lambda.EventSourceMapping(
      `${LAMBDA_BASE_NAME}-sqs-mapping`,
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
