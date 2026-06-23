import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Lambda } from '../../packages/lambda';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '../../packages/shared';

const LAMBDA_BASE_NAME = 'ai_projections_refresh_handler';
const CLOUD_STORAGE_BASE = `../../../rust/cloud-storage`;
const ZIP_LOCATION = `${CLOUD_STORAGE_BASE}/target/lambda/${LAMBDA_BASE_NAME}/bootstrap.zip`;

// Each cadence maps to its own schedule frequency. The lambda is invoked once
// per cadence with a constant input identifying which projections to sweep, so
// `refresh_cadence` controls how often a cadence's projections are checked.
const CADENCE_SCHEDULES: {
  cadence: 'high' | 'medium' | 'low';
  rate: string;
}[] = [
  { cadence: 'high', rate: 'rate(6 hours)' },
  { cadence: 'medium', rate: 'rate(1 day)' },
  { cadence: 'low', rate: 'rate(3 days)' },
];

export type AiProjectionsRefreshTriggerEnvVars = {
  DATABASE_URL: pulumi.Output<string> | string;
  AI_PROJECTION_QUEUE: pulumi.Output<string> | string;
  ENVIRONMENT: pulumi.Output<string> | string;
  RUST_LOG: pulumi.Output<string> | string;
};

type AiProjectionsRefreshTriggerArgs = {
  envVars: AiProjectionsRefreshTriggerEnvVars;
  aiProjectionQueueArn: pulumi.Output<string> | string;
  vpc: {
    vpcId: pulumi.Output<string> | string;
    publicSubnetIds: pulumi.Output<string[]> | string[];
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  tags: { [key: string]: string };
};

export class AiProjectionsRefreshTrigger extends pulumi.ComponentResource {
  role: aws.iam.Role;
  lambda: aws.lambda.Function;
  tags: { [key: string]: string };
  constructor(
    name: string,
    args: AiProjectionsRefreshTriggerArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:AiProjectionsRefreshTrigger', name, {}, opts);
    const { aiProjectionQueueArn, vpc, envVars, tags } = args;

    this.tags = tags;

    const sqsPolicy = new aws.iam.Policy(
      `${LAMBDA_BASE_NAME}-sqs-policy`,
      {
        policy: pulumi.output({
          Version: '2012-10-17',
          Statement: [
            {
              Action: ['sqs:SendMessage'],
              Resource: [pulumi.interpolate`${aiProjectionQueueArn}`],
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
        ],
        tags: this.tags,
      },
      { parent: this }
    );

    const aiProjectionsRefreshLambda =
      new Lambda<AiProjectionsRefreshTriggerEnvVars>(
        `${LAMBDA_BASE_NAME}-lambda`,
        {
          baseName: LAMBDA_BASE_NAME,
          handlerBase: CLOUD_STORAGE_BASE,
          zipLocation: ZIP_LOCATION,
          vpc,
          envVars,
          role: this.role,
          timeout: 60,
          tags: this.tags,
        },
        { parent: this }
      );

    this.lambda = aiProjectionsRefreshLambda.lambda;

    // One scheduled rule per cadence, each passing a constant input that tells
    // the handler which cadence's projections to sweep.
    for (const { cadence, rate } of CADENCE_SCHEDULES) {
      const triggerRule = new aws.cloudwatch.EventRule(
        `${LAMBDA_BASE_NAME}-${cadence}-rule`,
        {
          name: `${LAMBDA_BASE_NAME}-${cadence}-rule-${stack}`,
          scheduleExpression: rate,
          tags: this.tags,
        },
        { parent: this }
      );

      new aws.cloudwatch.EventTarget(
        `${LAMBDA_BASE_NAME}-${cadence}-target-${stack}`,
        {
          rule: triggerRule.name,
          arn: this.lambda.arn,
          input: JSON.stringify({ refresh_cadence: cadence }),
        },
        { parent: this }
      );

      new aws.lambda.Permission(
        `${LAMBDA_BASE_NAME}-${cadence}-permission-${stack}`,
        {
          action: 'lambda:InvokeFunction',
          function: this.lambda.name,
          principal: 'events.amazonaws.com',
          sourceArn: triggerRule.arn,
        },
        { parent: this }
      );
    }

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
