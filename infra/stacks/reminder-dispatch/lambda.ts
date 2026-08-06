import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Lambda } from '../../packages/lambda';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '../../packages/shared';

const BASE_NAME = 'reminder-dispatch-lambda';
const ZIP_FOLDER_NAME = 'reminder_dispatch_handler';
const REPO_ROOT = '../../..';
const HANDLER_BASE = `${REPO_ROOT}/services/${ZIP_FOLDER_NAME}`;
const ZIP_LOCATION = `${REPO_ROOT}/target/lambda/${ZIP_FOLDER_NAME}/bootstrap.zip`;

export type ReminderDispatchLambdaEnvVars = {
  DATABASE_URL: pulumi.Output<string> | string;
  ENVIRONMENT: pulumi.Output<string> | string;
  RUST_LOG: pulumi.Output<string> | string;
};

type ReminderDispatchLambdaArgs = {
  envVars: ReminderDispatchLambdaEnvVars;
  /** The notification ingress queue the dispatcher publishes to. */
  queueArns: pulumi.Output<string>[] | string[];
  vpc: {
    vpcId: pulumi.Output<string> | string;
    publicSubnetIds: pulumi.Output<string[]> | string[];
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  tags: { [key: string]: string };
};

/**
 * Sweeps reminders that have come due and publishes them to the notification
 * ingress queue, once a minute.
 *
 * Concurrency is pinned to 1 to bound database load, not for correctness:
 * a firing is claimed through a unique index on (reminder_id, scheduled_for),
 * so an overlapping invocation cannot double-send.
 */
export class ReminderDispatchLambda extends pulumi.ComponentResource {
  rule: aws.cloudwatch.EventRule;
  role: aws.iam.Role;
  lambda: aws.lambda.Function;
  tags: { [key: string]: string };

  constructor(
    name: string,
    args: ReminderDispatchLambdaArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:ReminderDispatchLambda', name, {}, opts);
    const { queueArns, vpc, envVars, tags } = args;

    this.tags = tags;

    const sqsPolicy = new aws.iam.Policy(
      `${BASE_NAME}-sqs-policy`,
      {
        name: `${BASE_NAME}-sqs-policy-${stack}`,
        policy: pulumi.output({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['sqs:SendMessage'],
              Resource: queueArns,
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
          sqsPolicy.arn,
        ],
        tags: this.tags,
      },
      { parent: this }
    );

    const lambda = new Lambda<ReminderDispatchLambdaEnvVars>(
      `${BASE_NAME}-lambda`,
      {
        baseName: BASE_NAME,
        handlerBase: HANDLER_BASE,
        zipLocation: ZIP_LOCATION,
        vpc,
        envVars,
        role: this.role,
        memorySize: 256,
        timeout: 120,
        reservedConcurrentExecutions: 1,
        tags: this.tags,
      },
      { parent: this }
    );

    this.lambda = lambda.lambda;

    this.rule = new aws.cloudwatch.EventRule(
      `${BASE_NAME}-rule`,
      {
        name: `${BASE_NAME}-rule-${stack}`,
        scheduleExpression: 'rate(1 minute)',
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.cloudwatch.EventTarget(
      `${BASE_NAME}-minutely-target`,
      {
        rule: this.rule.name,
        arn: this.lambda.arn,
      },
      { parent: this }
    );

    new aws.lambda.Permission(
      `${BASE_NAME}-minutely-target`,
      {
        action: 'lambda:InvokeFunction',
        function: this.lambda.name,
        principal: 'events.amazonaws.com',
        sourceArn: this.rule.arn,
      },
      { parent: this }
    );

    this.setupLambdaAlarms();
  }

  setupLambdaAlarms() {
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
