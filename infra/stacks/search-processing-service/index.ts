import * as pulumi from '@pulumi/pulumi';
import { DynamoDBTable } from '../../packages/resources';
import {
  BASE_DOMAIN,
  getKafkaClusterPolicy,
  getSearchEventQueue,
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

const { searchEventQueueArn } = getSearchEventQueue();

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

const backfillJobsTable = new DynamoDBTable('search-processing-backfill-jobs', {
  baseName: 'search-processing-backfill-jobs',
  attributes: [{ name: 'id', type: 'S' }],
  hashKey: 'id',
  ttl: { attributeName: 'expires_at' },
  tags,
});

const BASE_NAME = 'search-processing-service';

const searchProcessingService = new SearchProcessingService(
  `${BASE_NAME}-${stack}`,
  {
    extraManagedPolicyArns: [
      backfillJobsTable.policy.arn,
      getKafkaClusterPolicy(),
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

export const searchProcessingServiceUrl = `https://${
  stack === 'prod' ? '' : `${stack}-`
}gateway.${BASE_DOMAIN}/search-processing`;
export const searchProcessingServiceRoleArn = searchProcessingService.role.arn;
