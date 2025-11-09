import { Lambda } from '@lambda';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '@shared';

const BASE_NAME = 'email_suppression_handler';
const CLOUD_STORAGE_BASE = `../../../../rust/cloud-storage`;
const ZIP_LOCATION = `${CLOUD_STORAGE_BASE}/target/lambda/${BASE_NAME}/bootstrap.zip`;

export type EmailSuppressionLambdaEnvVars = {
  DATABASE_URL: pulumi.Output<string> | string;
  ENVIRONMENT: pulumi.Output<string> | string;
  RUST_LOG: pulumi.Output<string> | string;
};

type EmailSuppressionLambdaArgs = {
  envVars: EmailSuppressionLambdaEnvVars;
  vpc: {
    vpcId: pulumi.Output<string> | string;
    publicSubnetIds: pulumi.Output<string[]> | string[];
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  tags: { [key: string]: string };
};

export class EmailSuppressionLambda extends pulumi.ComponentResource {
  role: aws.iam.Role;
  lambda: aws.lambda.Function;
  tags: { [key: string]: string };
  constructor(
    name: string,
    args: EmailSuppressionLambdaArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:EmailSuppressionLambda', name, {}, opts);
    const { vpc, envVars, tags } = args;

    this.tags = tags;

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
        ],
        tags: this.tags,
      },
      { parent: this }
    );

    const emailSuppressionLambda = new Lambda<EmailSuppressionLambdaEnvVars>(
      `${BASE_NAME}-lambda`,
      {
        baseName: BASE_NAME,
        handlerBase: CLOUD_STORAGE_BASE,
        zipLocation: ZIP_LOCATION,
        vpc,
        envVars,
        role: this.role,
        reservedConcurrentExecutions: stack === 'prod' ? 50 : 10,
        tags: this.tags,
      },
      { parent: this }
    );

    this.lambda = emailSuppressionLambda.lambda;

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
