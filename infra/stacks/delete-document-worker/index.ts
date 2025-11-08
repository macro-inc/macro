import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, stack } from '@shared';
import { get_coparse_api_vpc } from '@vpc';
import { Worker } from './worker';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'cloud-storage-service',
};

const DATABASE_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_secret_key`),
  })
  .apply((secret) => secret.secretString);

export const coparse_api_vpc = get_coparse_api_vpc();

// ------------------------------------------- Cloud Storage -------------------------------------------
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

const cloudStorageClusterName: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterName')
  .apply((arn) => arn as string);

// ------------------------------------------- Cloud Storage Service -------------------------------------------
const cloudStorageServiceStack = new pulumi.StackReference(
  'cloud-storage-service-stack',
  {
    name: `macro-inc/cloud-storage-service/${stack}`,
  }
);

const deleteDocumentQueueArn: pulumi.Output<string> = cloudStorageServiceStack
  .getOutput('deleteDocumentQueueArn')
  .apply((arn) => arn as string);

const deleteDocumentQueueName: pulumi.Output<string> = cloudStorageServiceStack
  .getOutput('deleteDocumentQueueName')
  .apply((arn) => arn as string);

const SYNC_SERVICE_AUTH_KEY = config.require(`sync_service_auth_key`);
const syncServiceAuthKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: SYNC_SERVICE_AUTH_KEY })
  .apply((secret) => secret.arn);

const COMMS_SERVICE_AUTH_KEY = config.require(`comms_service_auth_key`);
const commsServiceAuthKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: COMMS_SERVICE_AUTH_KEY })
  .apply((secret) => secret.arn);

const PROPERTIES_SERVICE_AUTH_KEY = config.require(
  `properties_service_auth_key`
);
const propertiesServiceAuthKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: PROPERTIES_SERVICE_AUTH_KEY })
  .apply((secret) => secret.arn);

// ------------------------------------------- Delete Document Worker -------------------------------------------
const deleteDocumentWorker = new Worker(`delete-document-worker-${stack}`, {
  ecsClusterArn: cloudStorageClusterArn,
  vpc: coparse_api_vpc,
  platform: {
    family: 'linux',
    architecture: 'amd64',
  },
  documentStorageBucketArn: documentStorageBucketArn,
  serviceContainerPort: 8080,
  healthCheckPath: '/health',
  isPrivate: true,
  containerEnvVars: [
    {
      name: 'RUST_LOG',
      value: `delete_document_worker=${stack === 'prod' ? 'trace' : 'trace'},s3_client=debug`,
    },
    {
      name: 'ENVIRONMENT',
      value: stack,
    },
    {
      name: 'DATABASE_URL',
      value: pulumi.interpolate`${DATABASE_URL}`,
    },
    {
      name: 'REDIS_URI',
      value: pulumi.interpolate`rediss://${cloudStorageCacheEndpoint}`,
    },
    {
      name: 'DOCUMENT_STORAGE_BUCKET',
      value: pulumi.interpolate`${documentStorageBucketId}`,
    },
    {
      name: 'DELETE_DOCUMENT_QUEUE',
      value: pulumi.interpolate`${deleteDocumentQueueName}`,
    },
    {
      name: 'SYNC_SERVICE_AUTH_KEY',
      value: SYNC_SERVICE_AUTH_KEY,
    },
    {
      name: 'SYNC_SERVICE_URL',
      value: `https://sync-service${
        stack === 'prod' ? '' : `-${stack}`
      }.macroverse.workers.dev`,
    },
    {
      name: 'COMMS_SERVICE_AUTH_KEY',
      value: COMMS_SERVICE_AUTH_KEY,
    },
    {
      name: 'COMMS_SERVICE_URL',
      value: `https://comms-service${
        stack === 'prod' ? '' : `-${stack}`
      }.macro.com`,
    },
    {
      name: 'PROPERTIES_SERVICE_AUTH_KEY',
      value: PROPERTIES_SERVICE_AUTH_KEY,
    },
    {
      name: 'PROPERTIES_SERVICE_URL',
      value: `https://properties-service${
        stack === 'prod' ? '' : `-${stack}`
      }.macro.com`,
    },
    // {
    //   name: 'QUEUE_MAX_MESSAGES',
    //   value: '10',
    // },
    // {
    //   name: 'QUEUE_WAIT_TIME_SECONDS',
    //   value: '4',
    // },
  ],
  cloudStorageClusterName: cloudStorageClusterName,
  deleteDocumentQueueArn: deleteDocumentQueueArn,
  tags,
  secretKeyArns: [
    syncServiceAuthKeyArn,
    commsServiceAuthKeyArn,
    propertiesServiceAuthKeyArn,
  ],
});

export const deleteDocumentWorkerRoleArn = deleteDocumentWorker.role.arn;
