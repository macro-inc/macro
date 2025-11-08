import { WorkerTrigger } from '@lambda';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, stack } from '@shared';
import { ShaRefCountResetterWorker } from './sha-ref-count-resetter-worker';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'sha-ref-count-resetter',
};

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const cloudStorageCacheEndpoint: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageCacheEndpoint')
  .apply((arn) => arn as string);

const DATABASE_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_secret_key`),
  })
  .apply((secret) => secret.secretString);

const cloudStorageClusterArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterArn')
  .apply((arn) => arn as string);

const shaRefCountResetterWorker = new ShaRefCountResetterWorker(
  'sha-ref-count-resetter-worker',
  {
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
        value: 'sha_ref_count_resetter=info',
      },
    ],
    platform: {
      family: 'linux',
      architecture: 'amd64',
    },
    tags,
  }
);

export const shaRefCountResetterWorkerTaskDefinitionArn =
  shaRefCountResetterWorker.taskDefinition.taskDefinition.arn;

export const shaRefCountResetterWorkerImageUri =
  shaRefCountResetterWorker.image.imageUri;
export const shaRefCountResetterWorkerRoleArn =
  shaRefCountResetterWorker.role.arn;
export const shaRefCountResetterWorkerTaskArn =
  shaRefCountResetterWorker.taskDefinition.taskDefinition.arn;

const shaCleanupTriggerLambda = new WorkerTrigger(
  'sha-ref-count-resetter-trigger',
  {
    clusterArn: cloudStorageClusterArn,
    taskDefinitionArn: shaRefCountResetterWorkerTaskArn,
    tags,
  }
);

export const shaCleanupTriggerLambdaName = shaCleanupTriggerLambda.lambda.name;
