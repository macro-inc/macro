import { Lambda } from '@lambda';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '@shared';

const LAMBA_BASE_NAME = 'organization_retention_trigger';
const CLOUD_STORAGE_BASE = `../../../rust/cloud-storage`;
const ZIP_LOCATION = `${CLOUD_STORAGE_BASE}/target/lambda/${LAMBA_BASE_NAME}/bootstrap.zip`;

export type OrganizationRetentionTriggerEnvVars = {
  DATABASE_URL: pulumi.Output<string> | string;
  ORGANIZATION_RETENTION_QUEUE: pulumi.Output<string> | string;
  ENVIRONMENT: pulumi.Output<string> | string;
  RUST_LOG: pulumi.Output<string> | string;
};

type OrganizationRetentionTriggerArgs = {
  envVars: OrganizationRetentionTriggerEnvVars;
  organizationRetentionQueueArn: pulumi.Output<string> | string;
  vpc: {
    vpcId: pulumi.Output<string> | string;
    publicSubnetIds: pulumi.Output<string[]> | string[];
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  tags: { [key: string]: string };
};

export class OrganizationRetentionTrigger extends pulumi.ComponentResource {
  role: aws.iam.Role;
  lambda: aws.lambda.Function;
  tags: { [key: string]: string };
  constructor(
    name: string,
    args: OrganizationRetentionTriggerArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:OrganizationRetentionTrigger', name, {}, opts);
    const { organizationRetentionQueueArn, vpc, envVars, tags } = args;

    this.tags = tags;

    const sqsPolicy = new aws.iam.Policy(
      `${LAMBA_BASE_NAME}-sqs-policy`,
      {
        policy: pulumi.output({
          Version: '2012-10-17',
          Statement: [
            {
              Action: ['sqs:SendMessage'],
              Resource: [pulumi.interpolate`${organizationRetentionQueueArn}`],
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
        ],
        tags: this.tags,
      },
      { parent: this }
    );

    const organizationRetentionTriggerLambda =
      new Lambda<OrganizationRetentionTriggerEnvVars>(
        `${LAMBA_BASE_NAME}-lambda`,
        {
          baseName: LAMBA_BASE_NAME,
          handlerBase: CLOUD_STORAGE_BASE,
          zipLocation: ZIP_LOCATION,
          vpc,
          envVars,
          role: this.role,
          timeout: 5,
          reservedConcurrentExecutions: 1, // triggered 1 time per day
          tags: this.tags,
        },
        { parent: this }
      );

    this.lambda = organizationRetentionTriggerLambda.lambda;

    const triggerRule = new aws.cloudwatch.EventRule(
      `daily-rule`,
      {
        name: `${LAMBA_BASE_NAME}-daily-rule-${stack}`,
        scheduleExpression: 'rate(1 day)',
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.cloudwatch.EventTarget(
      `${LAMBA_BASE_NAME}-target-${stack}`,
      {
        rule: triggerRule.name,
        arn: this.lambda.arn,
      },
      { parent: this }
    );

    new aws.lambda.Permission(
      `${LAMBA_BASE_NAME}-target-${stack}`,
      {
        action: 'lambda:InvokeFunction',
        function: this.lambda.name,
        principal: 'events.amazonaws.com',
        sourceArn: triggerRule.arn,
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
