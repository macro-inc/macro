import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { DynamoDBTable } from '../../packages/resources';
import {
  config,
  getSearchEventQueue,
  getServiceUrl,
  ServiceUrl,
  stack,
} from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
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

const backfillJobsTable = new DynamoDBTable('search-processing-backfill-jobs', {
  baseName: 'search-processing-backfill-jobs',
  attributes: [{ name: 'id', type: 'S' }],
  hashKey: 'id',
  ttl: { attributeName: 'expires_at' },
  tags,
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

const DATABASE_URL_READONLY = config.require('macro_db_readonly_secret_key');
const databaseUrlReadonlyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: DATABASE_URL_READONLY })
  .apply((secret) => secret.arn);

const INTERNAL_AUTH_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`internal_auth_key`),
  })
  .apply((secret) => secret.secretString);

const searchProcessingService = new SearchProcessingService(
  `${BASE_NAME}-${stack}`,
  {
    secretKeyArns: [
      databaseUrlArn,
      databaseUrlReadonlyArn,
      opensearchPasswordArn,
    ],
    extraManagedPolicyArns: [backfillJobsTable.policy.arn],
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
        name: 'DATABASE_URL_READONLY',
        value: pulumi.interpolate`${DATABASE_URL_READONLY}`,
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
        // Flips the documents alias dispatch in opensearch_client between
        // the flat-chunk shape (`documents_v1`) and the parent/child join
        // shape (`documents_v2`). Set via Pulumi config and flipped at
        // cutover; defaults to `false` so the existing flat-shape paths
        // stay active until the alias is swapped.
        name: 'DOCUMENTS_INDEX_USES_JOIN',
        value: config.get('documents_index_uses_join') ?? 'false',
      },
      {
        // Same as DOCUMENTS_INDEX_USES_JOIN, but for the chats alias
        // (`chats_v1` flat -> `chats_v2` parent/child).
        name: 'CHATS_INDEX_USES_JOIN',
        value: config.get('chats_index_uses_join') ?? 'false',
      },
      {
        // Same as DOCUMENTS_INDEX_USES_JOIN, but for the call_records
        // alias (`call_records_v1` flat -> `call_records_v2`
        // parent/child).
        name: 'CALL_RECORDS_INDEX_USES_JOIN',
        value: config.get('call_records_index_uses_join') ?? 'false',
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
        name: 'WORKER_COUNT',
        value: '3', // 3 workers per instance
      },
      {
        name: ServiceUrl.LEXICAL_SERVICE_URL,
        value: getServiceUrl(ServiceUrl.LEXICAL_SERVICE_URL),
      },
      {
        name: 'BACKFILL_JOBS_TABLE',
        value: backfillJobsTable.table.name,
      },
      // OpenTelemetry / Datadog tracing configuration
      {
        name: 'DD_SERVICE',
        value: 'search-processing-service',
      },
      {
        name: 'DD_ENV',
        value: stack,
      },
    ],
    tags,
  }
);

export const searchProcessingServiceUrl = pulumi.interpolate`${searchProcessingService.domain}`;
export const searchProcessingServiceRoleArn = searchProcessingService.role.arn;
