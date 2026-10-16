import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Lambda } from '../../packages/lambda';
import { DATADOG_API_KEY_SECRET_ARN } from '../../packages/resources';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '../../packages/shared';

const BASE_NAME = 'notification_retention_handler';
const REPO_ROOT = '../../..';
// Pinned public x86_64 layer, verified in us-east-1. Supports OTLP gRPC.
const DATADOG_EXTENSION_ARN =
  'arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:101';

type RetentionEnvVars = {
  DATABASE_URL: pulumi.Output<string> | string;
  ENVIRONMENT: string;
  RUST_LOG: string;
  DD_SERVICE: string;
  DD_ENV: string;
  DD_SITE: string;
  DD_API_KEY_SECRET_ARN: pulumi.Output<string>;
  DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_GRPC_ENDPOINT: string;
  DD_SERVERLESS_LOGS_ENABLED: string;
};

type Args = {
  databaseUrl: pulumi.Output<string>;
  enabled: boolean;
  dryRun: boolean;
  vpc: {
    vpcId: pulumi.Output<string> | string;
    publicSubnetIds: pulumi.Output<string[]> | string[];
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  tags: Record<string, string>;
};

/** Isolated maintenance worker: disabled initially, then preview before deleting. */
export class NotificationRetention extends pulumi.ComponentResource {
  readonly lambda: aws.lambda.Function;

  constructor(
    name: string,
    args: Args,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('macro:notifications:Retention', name, {}, opts);
    const { databaseUrl, enabled, dryRun, vpc, tags } = args;
    const role = new aws.iam.Role(
      `${BASE_NAME}-role`,
      {
        assumeRolePolicy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { Service: 'lambda.amazonaws.com' },
              Action: 'sts:AssumeRole',
            },
          ],
        }),
        managedPolicyArns: [
          aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
          aws.iam.ManagedPolicy.AWSLambdaVPCAccessExecutionRole,
        ],
        tags,
      },
      { parent: this }
    );
    const datadogSecretPolicy = new aws.iam.RolePolicy(
      `${BASE_NAME}-datadog-key`,
      {
        role: role.id,
        policy: pulumi.jsonStringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: 'secretsmanager:GetSecretValue',
              Resource: DATADOG_API_KEY_SECRET_ARN,
            },
          ],
        }),
      },
      { parent: this }
    );
    this.lambda = new Lambda<RetentionEnvVars>(
      `${BASE_NAME}-lambda`,
      {
        baseName: BASE_NAME,
        handlerBase: `${REPO_ROOT}/services/${BASE_NAME}`,
        zipLocation: `${REPO_ROOT}/target/lambda/${BASE_NAME}/bootstrap.zip`,
        envVars: {
          DATABASE_URL: databaseUrl,
          ENVIRONMENT: stack,
          RUST_LOG: 'info',
          DD_SERVICE: 'notification-retention',
          DD_ENV: stack,
          DD_SITE: 'us5.datadoghq.com',
          DD_API_KEY_SECRET_ARN: DATADOG_API_KEY_SECRET_ARN,
          DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_GRPC_ENDPOINT: '127.0.0.1:4317',
          // Keep the existing CloudWatch → Firehose log path; avoid duplicates.
          DD_SERVERLESS_LOGS_ENABLED: 'false',
        },
        role,
        vpc,
        layers: [DATADOG_EXTENSION_ARN],
        memorySize: 256,
        timeout: 120,
        reservedConcurrentExecutions: 1,
        tags,
      },
      { parent: this }
    ).lambda;

    // Ensure the extension can fetch its key before EventBridge can invoke it.
    const rule = new aws.cloudwatch.EventRule(
      `${BASE_NAME}-schedule`,
      {
        scheduleExpression: 'rate(5 minutes)',
        state: enabled ? 'ENABLED' : 'DISABLED',
        tags,
      },
      { parent: this, dependsOn: [datadogSecretPolicy] }
    );
    new aws.cloudwatch.EventTarget(
      `${BASE_NAME}-target`,
      {
        rule: rule.name,
        arn: this.lambda.arn,
        input: JSON.stringify({ dry_run: dryRun }),
        retryPolicy: { maximumEventAgeInSeconds: 60, maximumRetryAttempts: 0 },
      },
      { parent: this }
    );
    new aws.lambda.Permission(
      `${BASE_NAME}-invoke`,
      {
        action: 'lambda:InvokeFunction',
        function: this.lambda.name,
        principal: 'events.amazonaws.com',
        sourceArn: rule.arn,
      },
      { parent: this }
    );
    // The next scheduled sweep retries any outstanding rows. Don't accumulate
    // asynchronous retries of an old invocation while the worker is throttled.
    new aws.lambda.FunctionEventInvokeConfig(
      `${BASE_NAME}-async-policy`,
      {
        functionName: this.lambda.name,
        maximumEventAgeInSeconds: 60,
        maximumRetryAttempts: 0,
      },
      { parent: this }
    );
    for (const metricName of ['Errors', 'Throttles']) {
      new aws.cloudwatch.MetricAlarm(
        `${BASE_NAME}-${metricName.toLowerCase()}`,
        {
          namespace: 'AWS/Lambda',
          metricName,
          dimensions: { FunctionName: this.lambda.name },
          statistic: 'Sum',
          period: 300,
          evaluationPeriods: 1,
          threshold: 1,
          comparisonOperator: 'GreaterThanOrEqualToThreshold',
          treatMissingData: 'notBreaching',
          alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
          tags,
        },
        { parent: this }
      );
    }
    new aws.cloudwatch.MetricAlarm(
      `${BASE_NAME}-missing-invocations`,
      {
        namespace: 'AWS/Lambda',
        metricName: 'Invocations',
        dimensions: { FunctionName: this.lambda.name },
        statistic: 'Sum',
        period: 900,
        evaluationPeriods: 1,
        threshold: 1,
        comparisonOperator: 'LessThanThreshold',
        treatMissingData: enabled ? 'breaching' : 'notBreaching',
        actionsEnabled: enabled,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags,
      },
      { parent: this }
    );
  }
}
