import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import {
  config,
  getAiToolsInfra,
  getMacroApiToken,
  getMacroNotify,
  getSearchEventQueue,
  getServiceUrl,
  ServiceUrl,
  stack,
} from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import {
  DocumentCognitionService,
  SERVICE_DOMAIN_NAME,
} from './document-cognition-service';

const tags = {
  environment: stack,
  env: stack,
  tech_lead: 'ehayes',
  project: 'document-cognition-service',
  service: 'document-cognition-service',
};

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

const fusionauthClientIdSecretKey = config.require(`fusionauth_client_id`);

const FUSIONAUTH_CLIENT_ID = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: fusionauthClientIdSecretKey,
  })
  .apply((secret) => secret.secretString);
const FUSIONAUTH_ISSUER = config.require(`fusionauth_issuer`);

const OPEN_ROUTER_API_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('open-router-api-key'),
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

const AUTHENTICATION_SERVICE_INTERNAL_API_KEY_SECRET_NAME = config.require(
  'authentication_service_internal_api_key'
);

const authenticationServiceInternalApiKeyArn: pulumi.Output<string> =
  aws.secretsmanager
    .getSecretVersionOutput({
      secretId: AUTHENTICATION_SERVICE_INTERNAL_API_KEY_SECRET_NAME,
    })
    .apply((secret) => secret.arn);

export const coparse_api_vpc = get_coparse_api_vpc();

// ── AI tools infra ───────────────────────────────────────────────────────────

const aiTools = getAiToolsInfra();

// ── Stack references ─────────────────────────────────────────────────────────

const connectionGatewayStack = new pulumi.StackReference(
  'connection-gateway-stack',
  {
    name: `macro-inc/connection-gateway/${stack}`,
  }
);

const connectionGatewayRedisUrl: pulumi.Output<string> = connectionGatewayStack
  .getOutput('connectionGatewayRedisUrl')
  .apply((url) => url as string);

const connectionGatewayTableName: pulumi.Output<string> = connectionGatewayStack
  .getOutput('connectionGatewayTableName')
  .apply((name) => name as string);

const connectionGatewayTablePolicyArn: pulumi.Output<string> =
  connectionGatewayStack
    .getOutput('connectionGatewayTablePolicyArn')
    .apply((arn) => arn as string);

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const cloudStorageServiceStack = new pulumi.StackReference(
  'cloud-storage-service',
  {
    name: `macro-inc/cloud-storage-service/${stack}`,
  }
);

export const deleteChatQueueArn: pulumi.Output<string> =
  cloudStorageServiceStack
    .getOutput('deleteChatQueueArn')
    .apply((arn) => arn as string);

export const deleteChatQueueName: pulumi.Output<string> =
  cloudStorageServiceStack
    .getOutput('deleteChatQueueName')
    .apply((name) => name as string);

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

const { notificationIngressQueueName, notificationIngressQueueArn } =
  getMacroNotify();

const { searchEventQueueName, searchEventQueueArn } = getSearchEventQueue();

const MACRO_API_TOKENS = getMacroApiToken();

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
      MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
      authenticationServiceInternalApiKeyArn,
      ...aiTools.secretArns,
    ],
    serviceContainerPort: 8080,
    healthCheckPath: '/health',
    bucketArns: [...aiTools.bucketArns],
    queueArns: [
      documentTextExtractorQueueArn,
      deleteChatQueueArn,
      searchEventQueueArn,
      notificationIngressQueueArn,
      ...aiTools.queueArns,
    ],
    connectionTablePolicyArn: connectionGatewayTablePolicyArn,
    containerEnvVars: [
      ...aiTools.envVars,
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
        value: pulumi.interpolate`${notificationIngressQueueName}`,
      },
      {
        name: ServiceUrl.CONNECTION_GATEWAY_URL,
        value: getServiceUrl(ServiceUrl.CONNECTION_GATEWAY_URL),
      },
      {
        name: 'SEARCH_EVENT_QUEUE',
        value: pulumi.interpolate`${searchEventQueueName}`,
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
        name: 'PERPLEXITY_API_KEY',
        value: pulumi.interpolate`${PERPLEXITY_API_KEY}`,
      },
      {
        name: ServiceUrl.AUTHENTICATION_SERVICE_URL,
        value: getServiceUrl(ServiceUrl.AUTHENTICATION_SERVICE_URL),
      },
      {
        name: 'AUTHENTICATION_SERVICE_SECRET_KEY',
        value: AUTHENTICATION_SERVICE_INTERNAL_API_KEY_SECRET_NAME,
      },
      {
        name: 'REDIS_HOST',
        value: pulumi.interpolate`redis://${connectionGatewayRedisUrl}`,
      },
      {
        name: 'CONNECTION_GATEWAY_TABLE',
        value: pulumi.interpolate`${connectionGatewayTableName}`,
      },
      // OpenTelemetry / Datadog tracing configuration
      {
        name: 'DD_SERVICE',
        value: 'document-cognition-service',
      },
      {
        name: 'DD_ENV',
        value: stack,
      },
      {
        name: 'DOCUMENT_COGNITION_SERVICE_URL',
        value: `https://${SERVICE_DOMAIN_NAME}`,
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
export const documentCognitionServiceRoleArn =
  documentCognitionService.role.arn;
