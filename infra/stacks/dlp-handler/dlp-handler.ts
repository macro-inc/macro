import { Lambda } from '@lambda';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '@shared';

const LAMBA_BASE_NAME = 'dataloss_prevention_handler';
const CLOUD_STORAGE_BASE = `../../../../rust/cloud-storage`;
const ZIP_LOCATION = `${CLOUD_STORAGE_BASE}/target/lambda/${LAMBA_BASE_NAME}/bootstrap.zip`;

export type EnvVars = {
  ENVIRONMENT: pulumi.Output<string> | string;
  RUST_LOG: pulumi.Output<string> | string;
  SNS_TOPIC_ARN: pulumi.Output<string> | string;
};

type Args = {
  envVars: EnvVars;
  snsTopicArn: pulumi.Output<string> | string;
  loggingBucketArn: pulumi.Output<string> | string;
  tags: { [key: string]: string };
};

export class DlpHandler extends pulumi.ComponentResource {
  role: aws.iam.Role;
  lambda: aws.lambda.Function;
  tags: { [key: string]: string };
  constructor(
    name: string,
    args: Args,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:DlpHandler', name, {}, opts);
    const { snsTopicArn, loggingBucketArn, envVars, tags } = args;

    this.tags = tags;

    const snsPolicy = new aws.iam.Policy(
      `${LAMBA_BASE_NAME}-sns-policy`,
      {
        policy: pulumi.output({
          Version: '2012-10-17',
          Statement: [
            {
              Action: ['sns:Publish'],
              Resource: [pulumi.interpolate`${snsTopicArn}`],
              Effect: 'Allow',
            },
          ],
        }),
        tags: this.tags,
      },
      { parent: this }
    );

    const s3Policy = new aws.iam.Policy(
      `${LAMBA_BASE_NAME}-s3-policy`,
      {
        policy: pulumi.output({
          Version: '2012-10-17',
          Statement: [
            {
              Action: ['s3:GetObject', 's3:DeleteObject'],
              Resource: [
                pulumi.interpolate`${loggingBucketArn}`,
                pulumi.interpolate`${loggingBucketArn}/*`,
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
          aws.iam.ManagedPolicies.AWSLambdaBasicExecutionRole,
          aws.iam.ManagedPolicies.AWSLambdaRole,
          aws.iam.ManagedPolicies.CloudWatchLogsFullAccess,
          snsPolicy.arn,
          s3Policy.arn,
        ],
        tags: this.tags,
      },
      { parent: this }
    );

    const lambda = new Lambda<EnvVars>(
      `${LAMBA_BASE_NAME}-lambda`,
      {
        baseName: LAMBA_BASE_NAME,
        handlerBase: CLOUD_STORAGE_BASE,
        zipLocation: ZIP_LOCATION,
        envVars,
        role: this.role,
        timeout: 30,
        reservedConcurrentExecutions: 25,
        tags: this.tags,
      },
      { parent: this }
    );

    this.lambda = lambda.lambda;

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
