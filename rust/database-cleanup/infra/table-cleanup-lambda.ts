import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from './resources/shared';
import { Lambda } from './resources/lambda/lambda';

const BASE_NAME = 'table-cleanup-lambda';
const HANDLER_BASE = '../table-cleanup-handler';
const ZIP_LOCATION = `${HANDLER_BASE}/target/lambda/table-cleanup-handler/bootstrap.zip`;

interface EnvVars {
  DATABASE_URL: pulumi.Output<string> | string;
  TABLE_NAME: pulumi.Output<string> | string;
  MAX_AGE_HOURS: pulumi.Output<string> | string;
  ENVIRONMENT: pulumi.Output<string> | string;
  RUST_LOG: pulumi.Output<string> | string;
}

type TableCleanupLambdaArgs = {
  vpc: {
    vpcId: pulumi.Output<string> | string;
    publicSubnetIds: pulumi.Output<string[]> | string[];
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  envVars: EnvVars;
  tags: { [key: string]: string };
};

export class TableCleanupLambda extends pulumi.ComponentResource {
  // The lambda role
  role: aws.iam.Role;

  // The lambda
  lambda: aws.lambda.Function;

  // The event bridge rule for invoking the lambda
  rule: aws.cloudwatch.EventRule;

  name: string;
  tags: { [key: string]: string };

  constructor(
    name: string,
    args: TableCleanupLambdaArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super(`my:components:${BASE_NAME}`, name, {}, opts);

    this.tags = args.tags;
    this.name = name;

    this.role = new aws.iam.Role(
      `${name}-${BASE_NAME}-role`,
      {
        name: `${name}-${BASE_NAME}-role-${stack}`,
        assumeRolePolicy: {
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
        },
        managedPolicyArns: [
          aws.iam.ManagedPolicies.AWSLambdaBasicExecutionRole,
          aws.iam.ManagedPolicies.AWSLambdaRole,
          aws.iam.ManagedPolicies.AWSLambdaVPCAccessExecutionRole,
          aws.iam.ManagedPolicies.CloudWatchLogsFullAccess,
        ],
        tags: this.tags,
      },
      { parent: this },
    );

    const lambda = new Lambda<EnvVars>(
      `${name}-${BASE_NAME}-lambda`,
      {
        baseName: `${name}-${BASE_NAME}`,
        handlerBase: HANDLER_BASE,
        zipLocation: ZIP_LOCATION,
        envVars: args.envVars,
        role: this.role,
        vpc: args.vpc,
        tags: this.tags,
      },
      { parent: this },
    );

    this.lambda = lambda.lambda;

    this.rule = new aws.cloudwatch.EventRule(
      `${name}-${BASE_NAME}-rule`,
      {
        name: `${name}-${BASE_NAME}-rule-${stack}`,
        scheduleExpression: 'rate(1 hour)',
        tags: this.tags,
      },
      { parent: this },
    );

    new aws.cloudwatch.EventTarget(
      `${name}-${BASE_NAME}-hourly-target`,
      {
        rule: this.rule.name,
        arn: this.lambda.arn,
      },
      { parent: this },
    );

    new aws.lambda.Permission(
      `${name}-${BASE_NAME}-hourly-target`,
      {
        action: 'lambda:InvokeFunction',
        function: this.lambda.name,
        principal: 'events.amazonaws.com',
        sourceArn: this.rule.arn,
      },
      { parent: this },
    );

    this.setupLambdaAlarms();
  }

  setupLambdaAlarms() {
    new aws.cloudwatch.MetricAlarm(
      `${this.name}-throttle-alarm`,
      {
        name: `${this.name}-throttle-count-${stack}`,
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
        alarmDescription: `Alarm when ${this.name} lambda experiences throttling.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this },
    );

    new aws.cloudwatch.MetricAlarm(
      `${this.name}-error-alarm`,
      {
        name: `${this.name}-error-count-${stack}`,
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
        alarmDescription: `Alarm when ${this.name} lambda experiences errors.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this },
    );
  }
}
