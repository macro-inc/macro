import { WorkerTrigger } from '@lambda';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, stack } from '@shared';
import { ShaWorker } from './sha-cleanup-worker';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'sha-cleanup',
};

const DATABASE_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_secret_key`),
  })
  .apply((secret) => secret.secretString);

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const documentStorageBucketArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('documentStorageBucketArn')
  .apply((arn) => arn as string);

const documentStorageBucketId: pulumi.Output<string> = cloudStorageStack
  .getOutput('documentStorageBucketId')
  .apply((id) => id as string);

const cloudStorageCacheEndpoint: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageCacheEndpoint')
  .apply((arn) => arn as string);

const cloudStorageClusterArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterArn')
  .apply((arn) => arn as string);

const shaCleanupWorker = new ShaWorker('sha-cleanup-worker', {
  containerEnvVars: [
    {
      name: 'REDIS_URI',
      value: pulumi.interpolate`rediss://${cloudStorageCacheEndpoint}`,
    },
    {
      name: 'DATABASE_URL',
      value: pulumi.interpolate`${DATABASE_URL}`,
    },
    {
      name: 'ENVIRONMENT',
      value: stack,
    },
    {
      name: 'RUST_LOG',
      value: 'sha_cleanup_worker=info',
    },
    {
      name: 'DOCUMENT_STORAGE_BUCKET',
      value: pulumi.interpolate`${documentStorageBucketId}`,
    },
  ],
  platform: {
    family: 'linux',
    architecture: 'amd64',
  },
  documentStorageBucketArn,
  tags,
});

export const shaCleanupWorkerImageUri = shaCleanupWorker.image.imageUri;
export const shaCleanupWorkerRoleArn = shaCleanupWorker.role.arn;
export const shaCleanupWorkerTaskArn =
  shaCleanupWorker.taskDefinition.taskDefinition.arn;

const shaCleanupTriggerLambda = new WorkerTrigger('sha-cleanup-trigger', {
  clusterArn: cloudStorageClusterArn,
  taskDefinitionArn: shaCleanupWorkerTaskArn,
  tags,
});

const shaCleanupTriggerRule = new aws.cloudwatch.EventRule(
  `sha-cleanup-hourly-rule-${stack}`,
  {
    name: `sha-cleanup-hourly-${stack}`,
    scheduleExpression: 'rate(1 hour)',
  }
);

new aws.cloudwatch.EventTarget(`sha-cleanup-hourly-target-${stack}`, {
  rule: shaCleanupTriggerRule.name,
  arn: shaCleanupTriggerLambda.lambda.arn,
});

new aws.lambda.Permission(`sha-cleanup-hourly-target-${stack}`, {
  action: 'lambda:InvokeFunction',
  function: shaCleanupTriggerLambda.lambda.name,
  principal: 'events.amazonaws.com',
  sourceArn: shaCleanupTriggerRule.arn,
});

export const shaCleanupTriggerLambdaName = shaCleanupTriggerLambda.lambda.name;
