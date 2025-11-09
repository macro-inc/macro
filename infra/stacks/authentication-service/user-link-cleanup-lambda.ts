import { Lambda } from '@lambda';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '@shared';

const LAMBDA_BASE_NAME = 'user_link_cleanup_handler';
const CLOUD_STORAGE_BASE = `../../../../rust/cloud-storage`;
const ZIP_LOCATION = `${CLOUD_STORAGE_BASE}/target/lambda/${LAMBDA_BASE_NAME}/bootstrap.zip`;

export type EnvVars = {
  DATABASE_URL: pulumi.Output<string> | string;
  ENVIRONMENT: pulumi.Output<string> | string;
  RUST_LOG: pulumi.Output<string> | string;
};

type Args = {
  envVars: EnvVars;
  vpc: {
    vpcId: pulumi.Output<string> | string;
    publicSubnetIds: pulumi.Output<string[]> | string[];
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  tags: { [key: string]: string };
};

export class UserLinkCleanupHandler extends pulumi.ComponentResource {
  rule: aws.cloudwatch.EventRule;
  role: aws.iam.Role;
  lambda: aws.lambda.Function;
  tags: { [key: string]: string };
  constructor(
    name: string,
    args: Args,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:Lambda', name, {}, opts);
    const { vpc, envVars, tags } = args;

    this.tags = tags;

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
          aws.iam.ManagedPolicies.AWSLambdaBasicExecutionRole,
          aws.iam.ManagedPolicies.AWSLambdaRole,
          aws.iam.ManagedPolicies.AWSLambdaVPCAccessExecutionRole,
          aws.iam.ManagedPolicies.CloudWatchLogsFullAccess,
        ],
        tags: this.tags,
      },
      { parent: this }
    );

    const lambda = new Lambda<EnvVars>(
      `${LAMBDA_BASE_NAME}-lambda`,
      {
        baseName: LAMBDA_BASE_NAME,
        handlerBase: CLOUD_STORAGE_BASE,
        zipLocation: ZIP_LOCATION,
        vpc,
        envVars,
        role: this.role,
        // The > memory size = greater speedz
        memorySize: 256,
        timeout: 120,
        reservedConcurrentExecutions: 1,
        tags: this.tags,
      },
      { parent: this }
    );

    this.lambda = lambda.lambda;

    this.rule = new aws.cloudwatch.EventRule(
      `${LAMBDA_BASE_NAME}-rule`,
      {
        name: `${LAMBDA_BASE_NAME}-rule-${stack}`,
        scheduleExpression: 'rate(8 hours)',
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.cloudwatch.EventTarget(
      `${LAMBDA_BASE_NAME}-hourly-target`,
      {
        rule: this.rule.name,
        arn: this.lambda.arn,
      },
      { parent: this }
    );

    new aws.lambda.Permission(
      `${LAMBDA_BASE_NAME}-hourly-target`,
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
