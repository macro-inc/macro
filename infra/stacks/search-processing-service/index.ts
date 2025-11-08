import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, getSearchEventQueue, stack } from '@shared';
import { get_coparse_api_vpc } from '@vpc';
import { SearchProcessingService } from './service';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'cloud-storage-search',
};

const vpc = get_coparse_api_vpc();

const { searchEventQueueName, searchEventQueueArn } = getSearchEventQueue();

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const cloudStorageClusterArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterArn')
  .apply((arn) => arn as string);

const cloudStorageClusterName: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterName')
  .apply((arn) => arn as string);

const documentStorageBucketArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('documentStorageBucketArn')
  .apply((arn) => arn as string);

const documentStorageBucketId: pulumi.Output<string> = cloudStorageStack
  .getOutput('documentStorageBucketId')
  .apply((id) => id as string);

const opensearchStack = new pulumi.StackReference('opensearch-stack', {
  name: `macro-inc/opensearch/${stack}`,
});

const OPENSEARCH_URL: pulumi.Output<string> = opensearchStack
  .getOutput('domainEndpoint')
  .apply((domainEndpoint) => `https://${domainEndpoint}`);

const OPENSEARCH_USERNAME = 'macrouser';
const OPENSEARCH_PASSWORD = config.require('opensearch_password_key');
const opensearchPasswordArn = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: OPENSEARCH_PASSWORD,
  })
  .apply((secret) => secret.arn);

const BASE_NAME = 'search-processing-service';

const DATABASE_URL = config.require('database_url_key');
const databaseUrlArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: DATABASE_URL })
  .apply((secret) => secret.arn);

const INTERNAL_AUTH_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`internal_auth_key`),
  })
  .apply((secret) => secret.secretString);

const SYNC_SERVICE_AUTH_KEY = config.require(`sync_service_auth_key`);
const syncServiceAuthKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: SYNC_SERVICE_AUTH_KEY })
  .apply((secret) => secret.arn);

const searchProcessingService = new SearchProcessingService(
  `${BASE_NAME}-${stack}`,
  {
    secretKeyArns: [
      databaseUrlArn,
      opensearchPasswordArn,
      syncServiceAuthKeyArn,
    ],
    searchEventQueueArn,
    ecsClusterArn: cloudStorageClusterArn,
    documentStorageBucketArn,
    clusterName: cloudStorageClusterName,
    vpc,
    platform: { family: 'linux', architecture: 'amd64' },
    serviceContainerPort: 8080,
    isPrivate: false,
    healthCheckPath: '/health',
    containerEnvVars: [
      { name: 'ENVIRONMENT', value: stack },
      {
        name: 'RUST_LOG',
        value: `search_processing_service=${
          stack === 'prod' ? 'info' : 'trace'
        },macro_db_client=info,sqs_worker=info,lexical_client=info`,
      },
      {
        name: 'DATABASE_URL',
        value: pulumi.interpolate`${DATABASE_URL}`,
      },
      {
        name: 'SEARCH_EVENT_QUEUE',
        value: pulumi.interpolate`${searchEventQueueName}`,
      },
      {
        name: 'QUEUE_MAX_MESSAGES',
        value: '10', // number of messages a single worker can process at a time
      },
      {
        name: 'QUEUE_WAIT_TIME_SECONDS',
        value: '20', // increased polling duration to avoid rate limiting
      },
      {
        name: 'OPENSEARCH_URL',
        value: OPENSEARCH_URL,
      },
      {
        name: 'OPENSEARCH_USERNAME',
        value: OPENSEARCH_USERNAME,
      },
      {
        name: 'OPENSEARCH_PASSWORD',
        value: OPENSEARCH_PASSWORD,
      },
      {
        name: 'DOCUMENT_STORAGE_BUCKET',
        value: pulumi.interpolate`${documentStorageBucketId}`,
      },
      {
        name: 'INTERNAL_API_SECRET_KEY',
        value: INTERNAL_AUTH_KEY,
      },
      {
        name: 'SYNC_SERVICE_AUTH_KEY',
        value: SYNC_SERVICE_AUTH_KEY,
      },
      {
        name: 'EMAIL_SERVICE_URL',
        value: `https://email-service${
          stack === 'prod' ? '' : `-${stack}`
        }.macro.com`,
      },
      {
        name: 'COMMS_SERVICE_URL',
        value: `https://comms-service${
          stack === 'prod' ? '' : `-${stack}`
        }.macro.com`,
      },
      {
        name: 'WORKER_COUNT',
        value: '3', // 3 workers per instance
      },
      {
        name: 'LEXICAL_SERVICE_URL',
        value: `https://lexical-service-${stack}.macroverse.workers.dev`,
      },
    ],
    tags,
  }
);

export const searchProcessingServiceUrl = pulumi.interpolate`${searchProcessingService.domain}`;
export const searchProcessingServiceRoleArn = searchProcessingService.role.arn;
