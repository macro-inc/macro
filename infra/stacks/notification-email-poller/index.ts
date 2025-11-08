import { WorkerTrigger } from '@lambda';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, stack } from '@shared';
import { Worker } from './notification-email-poller';

export let notificationEmailPollerWorkerImageUri:
  | pulumi.Output<string>
  | undefined;
export let notificationEmailPollerWorkerRoleArn:
  | pulumi.Output<string>
  | undefined;
export let notificationEmailPollerWorkerTaskArn:
  | pulumi.Output<string>
  | undefined;
export let notificationEmailPollerTriggerLambdaName:
  | pulumi.Output<string>
  | undefined;

if (stack !== 'prod') {
  const tags = {
    environment: stack,
    tech_lead: 'hutch',
    project: 'notifications',
  };

  const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
    name: `macro-inc/document-storage/${stack}`,
  });

  const cloudStorageClusterArn: pulumi.Output<string> = cloudStorageStack
    .getOutput('cloudStorageClusterArn')
    .apply((arn) => arn as string);

  const notificationServiceStack = new pulumi.StackReference(
    'notification-service-stack',
    {
      name: `macro-inc/notification-service/${stack}`,
    }
  );
  const notificationDatabaseEndpoint = notificationServiceStack
    .getOutput('notificationDatabaseEndpoint')
    .apply((endpoint) => endpoint as string);

  const notificationDatabasePassword = aws.secretsmanager
    .getSecretVersionOutput({
      secretId: config.require('db-password-secret-key'),
    })
    .apply((secret) => secret.secretString);

  const DATABASE_URL = pulumi
    .all([notificationDatabaseEndpoint, notificationDatabasePassword])
    .apply(
      // eslint-disable-next-line @typescript-eslint/no-shadow
      ([endpoint, password]) =>
        `postgresql://macrouser:${password}@${endpoint}/notificationdb`
    );

  const worker = new Worker('notification-email-poller-worker', {
    containerEnvVars: [
      {
        name: 'ENVIRONMENT',
        value: stack,
      },
      {
        name: 'RUST_LOG',
        value: `notification_email_poller_worker=${stack === 'prod' ? 'info' : 'debug'}`,
      },
      {
        name: 'DATABASE_URL',
        value: pulumi.interpolate`${DATABASE_URL}`,
      },
      {
        name: 'SENDER_BASE_ADDRESS',
        value: `notification.macro.com`,
      },
    ],
    platform: {
      family: 'linux',
      architecture: 'amd64',
    },
    tags,
  });

  notificationEmailPollerWorkerImageUri = worker.image.imageUri;
  notificationEmailPollerWorkerRoleArn = worker.role.arn;
  notificationEmailPollerWorkerTaskArn =
    worker.taskDefinition.taskDefinition.arn;

  const notificationEmailPollerTriggerLambda = new WorkerTrigger(
    'notification-email-poller-trigger',
    {
      clusterArn: cloudStorageClusterArn,
      taskDefinitionArn: pulumi.interpolate`${notificationEmailPollerWorkerTaskArn}`,
      tags,
    }
  );

  const notificationEmailPollerTriggerRule = new aws.cloudwatch.EventRule(
    `notification-email-poller-hourly-rule-${stack}`,
    {
      name: `notification-email-poller-hourly-${stack}`,
      scheduleExpression: 'rate(1 hour)', // start at 1hr rate. may increase if needed.
      tags,
    }
  );

  new aws.cloudwatch.EventTarget(`notification-email-poller-target-${stack}`, {
    rule: notificationEmailPollerTriggerRule.name,
    arn: notificationEmailPollerTriggerLambda.lambda.arn,
  });

  new aws.lambda.Permission(
    `notification-email-poller-trigger-permission-${stack}`,
    {
      action: 'lambda:InvokeFunction',
      function: notificationEmailPollerTriggerLambda.lambda.name,
      principal: 'events.amazonaws.com',
      sourceArn: notificationEmailPollerTriggerRule.arn,
    }
  );

  notificationEmailPollerTriggerLambdaName =
    notificationEmailPollerTriggerLambda.lambda.name;
}
