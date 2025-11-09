import { Lambda } from '@lambda';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '@shared';

const BASE_NAME = 'document-text-extractor';
const CLOUD_STORAGE_BASE = `../../../rust/cloud-storage`;
const ZIP_LOCATION = `${CLOUD_STORAGE_BASE}/target/lambda/${BASE_NAME}/bootstrap.zip`;

export type DocumentTextExtractorLambdaEnvVars = {
  DATABASE_URL: pulumi.Output<string> | string;
  ENVIRONMENT: pulumi.Output<string> | string;
  RUST_LOG: pulumi.Output<string> | string;
  DOCUMENT_STORAGE_BUCKET: pulumi.Output<string> | string;
};

type DocumentTextExtractorLambdaArgs = {
  envVars: DocumentTextExtractorLambdaEnvVars;
  docStorageBucketArn: pulumi.Output<string> | string;
  vpc: {
    vpcId: pulumi.Output<string> | string;
    publicSubnetIds: pulumi.Output<string[]> | string[];
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  tags: { [key: string]: string };
};

export class DocumentTextExtractorLambda extends pulumi.ComponentResource {
  queue: aws.sqs.Queue;
  dlq: aws.sqs.Queue;
  role: aws.iam.Role;
  lambda: aws.lambda.Function;
  tags: { [key: string]: string };
  constructor(
    name: string,
    args: DocumentTextExtractorLambdaArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:DocumentTextExtractorLambda', name, {}, opts);
    const { docStorageBucketArn, vpc, envVars, tags } = args;

    this.tags = tags;

    const s3Policy = new aws.iam.Policy(
      `${BASE_NAME}-s3-policy`,
      {
        policy: pulumi.output({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['s3:ListBucket', 's3:GetObject'],
              Resource: [
                docStorageBucketArn,
                pulumi.interpolate`${docStorageBucketArn}/*`,
              ],
            },
            {
              Action: ['s3:ListBucket', 's3:PutObject'],
              Resource: [
                docStorageBucketArn,
                pulumi.interpolate`${docStorageBucketArn}/*`,
              ],
              Effect: 'Allow',
            },
          ],
        }),
        tags: this.tags,
      },
      { parent: this }
    );

    this.dlq = new aws.sqs.Queue(
      `${BASE_NAME}-lambda-dlq-${stack}`,
      {
        name: `${BASE_NAME}-lambda-dlq-${stack}`,
        messageRetentionSeconds: 1209600,
        tags,
      },
      { parent: this }
    );

    this.queue = new aws.sqs.Queue(
      `${BASE_NAME}-lambda-queue-${stack}`,
      {
        name: `${BASE_NAME}-lambda-queue-${stack}`,
        redrivePolicy: this.dlq.arn.apply((arn) =>
          JSON.stringify({
            deadLetterTargetArn: arn,
            maxReceiveCount: 1,
          })
        ),
        tags,
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
        ],
        tags: this.tags,
      },
      { parent: this }
    );

    const documentTextExtractorLambda =
      new Lambda<DocumentTextExtractorLambdaEnvVars>(
        `${BASE_NAME}-lambda`,
        {
          baseName: BASE_NAME,
          handlerBase: CLOUD_STORAGE_BASE,
          zipLocation: ZIP_LOCATION,
          vpc,
          envVars,
          role: this.role,
          // timeout at 5 minutes
          timeout: 300,
          // The > memory size = greater speedz
          memorySize: 1024,
          reservedConcurrentExecutions: 50,
          tags: this.tags,
        },
        { parent: this }
      );

    this.lambda = documentTextExtractorLambda.lambda;

    new aws.lambda.Permission(
      `lambda-sqs-policy`,
      {
        action: 'lambda:InvokeFunction',
        function: this.lambda.name,
        principal: 'sqs.amazonaws.com',
        sourceArn: this.queue.arn,
      },
      { parent: this }
    );

    new aws.lambda.EventSourceMapping(
      `lambda-sqs-mapping`,
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
