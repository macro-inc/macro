import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, getMacroApiToken, stack } from '@shared';
import { get_coparse_api_vpc } from '@vpc';
import { SearchService } from './service';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'cloud-storage-search',
};

const vpc = get_coparse_api_vpc();

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const cloudStorageClusterArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterArn')
  .apply((arn) => arn as string);

const cloudStorageClusterName: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterName')
  .apply((arn) => arn as string);

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

const BASE_NAME = 'search-service';

const DATABASE_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_secret_key`),
  })
  .apply((secret) => secret.secretString);

const INTERNAL_AUTH_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`internal_auth_key`),
  })
  .apply((secret) => secret.secretString);

const JWT_SECRET_KEY = config.require(`jwt_secret_key`);
const jwtSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

const AUDIENCE = config.require(`fusionauth_client_id`);
const ISSUER = config.require(`fusionauth_issuer`);

const MACRO_API_TOKENS = getMacroApiToken();

const searchService = new SearchService(`${BASE_NAME}-${stack}`, {
  secretKeyArns: [
    opensearchPasswordArn,
    jwtSecretKeyArn,
    MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
  ],
  ecsClusterArn: cloudStorageClusterArn,
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
      value: `search_service=${
        stack === 'prod' ? 'info' : 'trace'
      },macro_db_client=info`,
    },
    {
      name: 'DATABASE_URL',
      value: pulumi.interpolate`${DATABASE_URL}`,
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
      name: 'INTERNAL_API_SECRET_KEY',
      value: INTERNAL_AUTH_KEY,
    },
    {
      name: 'JWT_SECRET_KEY',
      value: pulumi.interpolate`${JWT_SECRET_KEY}`,
    },
    {
      name: 'AUDIENCE',
      value: pulumi.interpolate`${AUDIENCE}`,
    },
    {
      name: 'ISSUER',
      value: pulumi.interpolate`${ISSUER}`,
    },
    {
      name: 'COMMS_SERVICE_URL',
      value: `https://comms-service${
        stack === 'prod' ? '' : `-${stack}`
      }.macro.com`,
    },
    {
      name: 'EMAIL_SERVICE_URL',
      value: `https://email-service${
        stack === 'prod' ? '' : `-${stack}`
      }.macro.com`,
    },
    {
      name: 'DOCUMENT_STORAGE_SERVICE_URL',
      value: `https://cloud-storage${
        stack === 'prod' ? '' : `-${stack}`
      }.macro.com`,
    },
    {
      name: 'MACRO_API_TOKEN_ISSUER',
      value: pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenIssuer}`,
    },
    {
      name: 'MACRO_API_TOKEN_PUBLIC_KEY',
      value: pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenPublicKey}`,
    },
  ],
  tags,
});

export const searchServiceUrl = pulumi.interpolate`${searchService.domain}`;
export const searchServiceRoleArn = searchService.role.arn;
