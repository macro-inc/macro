import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import {
  config,
  getMacroApiToken,
  getMacroNotify,
  getSearchEventQueue,
  stack,
} from '@shared';
import { get_coparse_api_vpc } from '@vpc';
import { DocumentCognitionService } from './document-cognition-service';

const tags = {
  environment: stack,
  env: stack,
  tech_lead: 'ehayes',
  project: 'document-cognition-service',
  service: 'document-cognition-service',
};

const SYNC_SERVICE_AUTH_KEY = config.require(`sync_service_auth_key`);
const syncServiceAuthKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: SYNC_SERVICE_AUTH_KEY })
  .apply((secret) => secret.arn);

// NOTE: NEVER EVER EVER EXPORT THIS. ITS A SECRET VALUE
const DATABASE_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_secret_key`),
  })
  .apply((secret) => secret.secretString);

const JWT_SECRET_KEY = config.require(`jwt_secret_key`);
const jwtSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

const FUSIONAUTH_CLIENT_ID = config.require(`fusionauth_client_id`);
const FUSIONAUTH_ISSUER = config.require(`fusionauth_issuer`);

const OPEN_ROUTER_API_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('open-router-api-key'),
  })
  .apply((secret) => secret.secretString);

const INTERNAL_AUTH_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`internal_auth_key`),
  })
  .apply((secret) => secret.secretString);

const OPENAI_API_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.get('openai_api_key') ?? '',
  })
  .apply((secret) => secret.secretString);

const XAI_API_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.get('xai-api-key') ?? '',
  })
  .apply((secret) => secret.secretString);

const ANTHROPIC_API_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.get('anthropic_api_key') ?? '',
  })
  .apply((secret) => {
    return secret.secretString;
  });
const GCP_SERVICE_ACCOUNT = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.get('gcp_service_account') ?? '',
  })
  .apply((secret) => secret.secretString);

const PERPLEXITY_API_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.get('perplexity-api-key') ?? '',
  })
  .apply((secret) => secret.secretString);

export const coparse_api_vpc = get_coparse_api_vpc();

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const cloudStorageServiceStack = new pulumi.StackReference(
  'cloud-storage-service',
  {
    name: `macro-inc/cloud-storage-service/${stack}`,
  }
);

export const documentStorageServiceUrl: pulumi.Output<string> =
  cloudStorageServiceStack
    .getOutput('cloudStorageServiceUrl')
    .apply((cloudStorageServiceUrl) => cloudStorageServiceUrl as string);

export const meteringServiceUrl = `https://metering${stack === 'prod' ? '' : `-${stack}`}.macro.com`;

const documentTextExtractorStack = new pulumi.StackReference(
  'document-text-extractor',
  {
    name: `macro-inc/document-text-extractor/${stack}`,
  }
);

const documentTextExtractorQueueArn: pulumi.Output<string> =
  documentTextExtractorStack
    .getOutput('documentTextExtractorLambdaQueueArn')
    .apply((arn) => arn as string);

const documentTextExtractorQueueName: pulumi.Output<string> =
  documentTextExtractorStack
    .getOutput('documentTextExtractorLambdaQueueName')
    .apply((name) => name as string);

const cloudStorageClusterArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterArn')
  .apply((arn) => arn as string);

const cloudStorageClusterName: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterName')
  .apply((arn) => arn as string);

const documentStorageBucketId: pulumi.Output<string> = cloudStorageStack
  .getOutput('documentStorageBucketId')
  .apply((id) => id as string);

export const deleteChatQueueArn: pulumi.Output<string> =
  cloudStorageServiceStack
    .getOutput('deleteChatQueueArn')
    .apply((arn) => arn as string);

export const deleteChatQueueName: pulumi.Output<string> =
  cloudStorageServiceStack
    .getOutput('deleteChatQueueName')
    .apply((name) => name as string);

const { notificationQueueName, notificationQueueArn } = getMacroNotify();

// import the insight-service-block
const insightServiceStack = new pulumi.StackReference('insight-service-stack', {
  name: `macro-inc/insight-service/${stack}`,
});

const insightContextQueueArn: pulumi.Output<string> = insightServiceStack
  .getOutput('contextQueueArn')
  .apply((arn) => arn as string);

const insightContextQueueName: pulumi.Output<string> = insightServiceStack
  .getOutput('contextQueueName')
  .apply((name) => name as string)
  .apply((name) => {
    pulumi.log.info(`INSIGHT QUEUE NAME, ${name}`);
    return name;
  });

const { searchEventQueueName, searchEventQueueArn } = getSearchEventQueue();

const searchServiceStack = new pulumi.StackReference('search-service-stack', {
  name: `macro-inc/search-service/${stack}`,
});

const searchServiceUrl: pulumi.Output<string> = searchServiceStack
  .getOutput('searchServiceUrl')
  .apply((arn) => arn as string);

const MACRO_API_TOKENS = getMacroApiToken();

// Import the search text extractor queue stack
const documentCognitionService = new DocumentCognitionService(
  `document-cognition-service-${stack}`,
  {
    ecsClusterArn: cloudStorageClusterArn,
    cloudStorageClusterName: cloudStorageClusterName,
    vpc: coparse_api_vpc,
    platform: {
      family: 'linux',
      architecture: 'amd64',
    },
    secretKeyArns: [
      jwtSecretKeyArn,
      syncServiceAuthKeyArn,
      MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
    ],
    serviceContainerPort: 8080,
    healthCheckPath: '/health',
    queueArns: [
      documentTextExtractorQueueArn,
      deleteChatQueueArn,
      searchEventQueueArn,
      insightContextQueueArn,
      notificationQueueArn,
    ],
    containerEnvVars: [
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
        value: `info`,
      },
      {
        name: 'INTERNAL_API_SECRET_KEY',
        value: pulumi.interpolate`${INTERNAL_AUTH_KEY}`,
      },
      {
        name: 'OPEN_ROUTER_API_KEY',
        value: pulumi.interpolate`${OPEN_ROUTER_API_KEY}`,
      },
      {
        name: 'OPENAI_API_KEY',
        value: pulumi.interpolate`${OPENAI_API_KEY}`,
      },
      {
        name: 'ANTHROPIC_API_KEY',
        value: pulumi.interpolate`${ANTHROPIC_API_KEY}`,
      },
      {
        name: 'XAI_API_KEY',
        value: pulumi.interpolate`${XAI_API_KEY}`,
      },
      {
        name: 'DOCUMENT_TEXT_EXTRACTOR_QUEUE',
        value: pulumi.interpolate`${documentTextExtractorQueueName}`,
      },
      {
        name: 'CHAT_DELETE_QUEUE',
        value: pulumi.interpolate`${deleteChatQueueName}`,
      },
      {
        name: 'DOCUMENT_STORAGE_BUCKET',
        value: pulumi.interpolate`${documentStorageBucketId}`,
      },
      {
        name: 'DOCUMENT_STORAGE_SERVICE_URL',
        value: pulumi.interpolate`${documentStorageServiceUrl}`,
      },
      {
        name: 'GCP_SERVICE_ACCOUNT',
        value: pulumi.interpolate`${GCP_SERVICE_ACCOUNT}`,
      },
      { name: 'ISSUER', value: pulumi.interpolate`${FUSIONAUTH_ISSUER}` },
      {
        name: 'JWT_SECRET_KEY',
        value: pulumi.interpolate`${JWT_SECRET_KEY}`,
      },
      {
        name: 'AUDIENCE',
        value: pulumi.interpolate`${FUSIONAUTH_CLIENT_ID}`,
      },
      {
        name: 'NOTIFICATION_QUEUE',
        value: pulumi.interpolate`${notificationQueueName}`,
      },
      {
        name: 'STATIC_FILE_SERVICE_URL',
        value: `https://static-file-service${
          stack === 'prod' ? '' : `-${stack}`
        }.macro.com`,
      },
      {
        name: 'INSIGHT_CONTEXT_QUEUE',
        value: pulumi.interpolate`${insightContextQueueName}`,
      },
      {
        name: 'COMMS_SERVICE_URL',
        value: `https://comms-service${
          stack === 'prod' ? '' : `-${stack}`
        }.macro.com`,
      },
      {
        name: 'CONNECTION_GATEWAY_URL',
        value: `https://connection-gateway${
          stack === 'prod' ? '' : `-${stack}`
        }.macro.com`,
      },
      {
        name: 'SEARCH_EVENT_QUEUE',
        value: pulumi.interpolate`${searchEventQueueName}`,
      },
      {
        name: 'SYNC_SERVICE_AUTH_KEY',
        value: pulumi.interpolate`${SYNC_SERVICE_AUTH_KEY}`,
      },
      {
        name: 'METERING_SERVICE_URL',
        value: pulumi.interpolate`${meteringServiceUrl}`,
      },
      {
        name: 'SYNC_SERVICE_URL',
        value: `https://sync-service-${stack}.macroverse.workers.dev`,
      },
      {
        name: 'MACRO_API_TOKEN_ISSUER',
        value: pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenIssuer}`,
      },
      {
        name: 'MACRO_API_TOKEN_PUBLIC_KEY',
        value: pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenPublicKey}`,
      },
      {
        name: 'SEARCH_SERVICE_URL',
        value: pulumi.interpolate`${searchServiceUrl}`,
      },
      {
        name: 'PERPLEXITY_API_KEY',
        value: pulumi.interpolate`${PERPLEXITY_API_KEY}`,
      },
      {
        name: 'LEXICAL_SERVICE_URL',
        value: `https://lexical-service-${stack}.macroverse.workers.dev`,
      },
      {
        name: 'EMAIL_SERVICE_URL',
        value: `https://email-service${
          stack === 'prod' ? '' : `-${stack}`
        }.macro.com`,
      },
      {
        name: 'STATIC_FILE_SERVICE_URL',
        value: `https://static-file-service${stack === 'prod' ? '' : `-${stack}`}.macro.com`,
      },
    ],
    isPrivate: false,
    tags,
  }
);

export const documentCognitionServiceSgId =
  documentCognitionService.serviceSg.id;
export const documentCognitionServiceAlbSgId =
  documentCognitionService.serviceAlbSg.id;
export const documentCognitionServiceUrl = pulumi.interpolate`${documentCognitionService.domain}`;
