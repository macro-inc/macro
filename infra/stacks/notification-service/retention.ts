import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Lambda } from '../../packages/lambda';
import { DATADOG_API_KEY_SECRET_ARN } from '../../packages/resources';
import {
  CLOUD_TRAIL_SNS_TOPIC_ARN,
  grafanaIngestSecretArn,
  grafanaTelemetryEnabled,
  stack,
} from '../../packages/shared';

const BASE_NAME = 'notification_retention_handler';
const REPO_ROOT = '../../..';
// Pinned public x86_64 layer, verified in us-east-1. Supports OTLP gRPC.
const DATADOG_EXTENSION_ARN =
  'arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:101';
// Pinned public x86_64 OpenTelemetry Collector layer (release 0.24.0, collector
// v0.163.0), verified in us-east-1. It sends a copy of the spans to Grafana.
const GRAFANA_COLLECTOR_ARN =
  'arn:aws:lambda:us-east-1:184161586896:layer:opentelemetry-collector-amd64-0_24_0:1';
// The same local address the ECS services' Alloy sidecar listens on.
const GRAFANA_OTLP_ENDPOINT = 'http://127.0.0.1:14317';

/**
 * The Grafana collector's whole config, as JSON (which is YAML). The collector
 * reads the ingest token from Secrets Manager when it starts; it never sits in
 * the environment. One export per flush, bounded below the entrypoint's
 * two-second Grafana timeout and with no queue or retries, so a Grafana outage
 * costs one failed export, not a late or failed sweep.
 */
function grafanaCollectorConfig(secretArn: pulumi.Output<string>) {
  return pulumi.jsonStringify({
    receivers: {
      otlp: { protocols: { grpc: { endpoint: '127.0.0.1:14317' } } },
    },
    exporters: {
      'otlphttp/grafana': {
        endpoint: 'https://otlp.macro-internal.com',
        headers: {
          Authorization: pulumi.interpolate`Bearer \${secretsmanager:${secretArn}}`,
        },
        timeout: '1500ms',
        sending_queue: { enabled: false },
        retry_on_failure: { enabled: false },
      },
    },
    service: {
      pipelines: {
        traces: { receivers: ['otlp'], exporters: ['otlphttp/grafana'] },
      },
      telemetry: { logs: { level: 'warn' }, metrics: { level: 'none' } },
    },
  });
}

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
  GRAFANA_OTLP_ENDPOINT?: string;
  GRAFANA_COLLECTOR_CONFIG?: pulumi.Output<string>;
  OPENTELEMETRY_COLLECTOR_CONFIG_URI?: string;
  OPENTELEMETRY_EXTENSION_LOG_LEVEL?: string;
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

/** Isolated maintenance worker with explicit scheduling and dry-run controls. */
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
    // Stacks whose ECS services send to Grafana (grafanaTelemetryEnabled) send
    // this function's spans too. The collector carries only spans; the logs go
    // through the Lambda component's CloudWatch log subscriptions.
    const grafana =
      grafanaTelemetryEnabled && grafanaIngestSecretArn
        ? {
            secretArn: grafanaIngestSecretArn,
            policy: new aws.iam.RolePolicy(
              `${BASE_NAME}-grafana-key`,
              {
                role: role.id,
                policy: pulumi.jsonStringify({
                  Version: '2012-10-17',
                  Statement: [
                    {
                      Effect: 'Allow',
                      Action: 'secretsmanager:GetSecretValue',
                      Resource: grafanaIngestSecretArn,
                    },
                  ],
                }),
              },
              { parent: this }
            ),
          }
        : undefined;
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
          ...(grafana && {
            GRAFANA_OTLP_ENDPOINT,
            GRAFANA_COLLECTOR_CONFIG: grafanaCollectorConfig(grafana.secretArn),
            OPENTELEMETRY_COLLECTOR_CONFIG_URI: 'env:GRAFANA_COLLECTOR_CONFIG',
            OPENTELEMETRY_EXTENSION_LOG_LEVEL: 'warn',
          }),
        },
        role,
        vpc,
        layers: grafana
          ? [DATADOG_EXTENSION_ARN, GRAFANA_COLLECTOR_ARN]
          : [DATADOG_EXTENSION_ARN],
        memorySize: 256,
        timeout: 120,
        reservedConcurrentExecutions: 1,
        tags,
      },
      { parent: this }
    ).lambda;

    // Ensure the extensions can fetch their keys before EventBridge can invoke
    // the function. The collector can't start without its key, and then the
    // function's init fails.
    const rule = new aws.cloudwatch.EventRule(
      `${BASE_NAME}-schedule`,
      {
        scheduleExpression: 'rate(1 hour)',
        state: enabled ? 'ENABLED' : 'DISABLED',
        tags,
      },
      {
        parent: this,
        dependsOn: grafana
          ? [datadogSecretPolicy, grafana.policy]
          : [datadogSecretPolicy],
      }
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
        metricQueries: [
          {
            id: 'invocations',
            metric: {
              namespace: 'AWS/Lambda',
              metricName: 'Invocations',
              dimensions: { FunctionName: this.lambda.name },
              period: 3600,
              stat: 'Sum',
            },
            returnData: false,
          },
          {
            id: 'hourly_invocations',
            // Fill silent hours so older samples cannot mask a stopped schedule.
            expression: 'FILL(invocations, 0)',
            returnData: true,
          },
        ],
        evaluationPeriods: 3,
        datapointsToAlarm: 3,
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
