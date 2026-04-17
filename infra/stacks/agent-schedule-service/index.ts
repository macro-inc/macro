import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import {
  config,
  getMacroApiToken,
  getMacroNotify,
  stack,
} from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { AgentScheduleService } from './service';

const tags = {
  environment: stack,
  env: stack,
  tech_lead: 'ehayes',
  project: 'agent-schedule-service',
  service: 'agent-schedule-service',
};

// ── Secrets ──────────────────────────────────────────────────────────────────

const DATABASE_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('macro_db_secret_key'),
  })
  .apply((secret) => secret.secretString);

const JWT_SECRET_KEY = config.require('jwt_secret_key');
const jwtSecretKeyArn = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

const FUSIONAUTH_CLIENT_ID = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('fusionauth_client_id'),
  })
  .apply((secret) => secret.secretString);

const FUSIONAUTH_ISSUER = config.require('fusionauth_issuer');

const OPEN_ROUTER_API_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('open-router-api-key'),
  })
  .apply((secret) => secret.secretString);

const OPENAI_API_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('openai_api_key'),
  })
  .apply((secret) => secret.secretString);

const XAI_API_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('xai-api-key'),
  })
  .apply((secret) => secret.secretString);

const ANTHROPIC_API_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('anthropic_api_key'),
  })
  .apply((secret) => secret.secretString);

const PERPLEXITY_API_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('perplexity-api-key'),
  })
  .apply((secret) => secret.secretString);

// Name of the Secrets Manager entry that holds the internal auth key. The
// env var passes this NAME; the container fetches the current value at
// runtime via the secrets manager client. The task role's read permission
// is granted below via `internalAuthKeyArn` in `secretKeyArns`.
const INTERNAL_AUTH_KEY_NAME = config.require('internal_auth_key');
const internalAuthKeyArn = aws.secretsmanager
  .getSecretVersionOutput({ secretId: INTERNAL_AUTH_KEY_NAME })
  .apply((secret) => secret.arn);

const MACRO_API_TOKENS = getMacroApiToken();
const { notificationIngressQueueArn, notificationIngressQueueName } =
  getMacroNotify();

// ── Stack references ─────────────────────────────────────────────────────────

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const cloudStorageServiceStack = new pulumi.StackReference(
  'cloud-storage-service',
  {
    name: `macro-inc/cloud-storage-service/${stack}`,
  }
);

const linksharingStack = new pulumi.StackReference('linksharing-stack', {
  name: `macro-inc/link-sharing/${stack}`,
});

const emailServiceStack = new pulumi.StackReference('email-service-stack', {
  name: `macro-inc/email-service/${stack}`,
});

const cloudStorageClusterArn = cloudStorageStack
  .getOutput('cloudStorageClusterArn')
  .apply((value) => value as string);

const cloudStorageClusterName = cloudStorageStack
  .getOutput('cloudStorageClusterName')
  .apply((value) => value as string);

const documentStorageBucketId = cloudStorageStack
  .getOutput('documentStorageBucketId')
  .apply((value) => value as string);

const documentStorageBucketArn = cloudStorageStack
  .getOutput('documentStorageBucketArn')
  .apply((value) => value as string);

const docxUploadBucketName = cloudStorageServiceStack
  .getOutput('docxUploadBucketName')
  .apply((value) => value as string);

const docxUploadBucketArn = cloudStorageServiceStack
  .getOutput('docxUploadBucketArn')
  .apply((value) => value as string);

const documentStorageServiceUrl = cloudStorageServiceStack
  .getOutput('cloudStorageServiceUrl')
  .apply((value) => value as string);

const cloudfrontDistributionUrl = linksharingStack
  .getOutput('cloudfrontDistributionUrl')
  .apply((value) => value as string);

const cloudfrontSignerPublicKeyId = linksharingStack
  .getOutput('cloudfrontDistributionPublicKeyId')
  .apply((value) => value as string);

const CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME = `linksharing-private-key-${stack}`;
const cloudfrontPrivateKeySecretArn = aws.secretsmanager
  .getSecretOutput({
    name: CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME,
  })
  .apply((secret) => secret.arn);

const emailScheduledQueueArn = emailServiceStack
  .getOutput('scheduledQueueArn')
  .apply((value) => value as string);

const emailScheduledQueueName = emailServiceStack
  .getOutput('scheduledQueueName')
  .apply((value) => value as string);

// ── Service ──────────────────────────────────────────────────────────────────

const vpc = get_coparse_api_vpc();

const service = new AgentScheduleService(`agent-schedule-service-${stack}`, {
  vpc,
  tags,
  platform: { family: 'linux', architecture: 'amd64' },
  serviceContainerPort: 8080,
  healthCheckPath: '/health',
  isPrivate: false,
  ecsClusterArn: cloudStorageClusterArn,
  cloudStorageClusterName,
  secretKeyArns: [
    jwtSecretKeyArn,
    cloudfrontPrivateKeySecretArn,
    MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
    internalAuthKeyArn,
  ],
  queueArns: [notificationIngressQueueArn, emailScheduledQueueArn],
  bucketArns: [documentStorageBucketArn, docxUploadBucketArn],
  containerEnvVars: [
    // Core
    {
      name: 'DATABASE_URL',
      value: pulumi.interpolate`${DATABASE_URL}`,
    },
    {
      name: 'PORT',
      value: '8080',
    },
    {
      name: 'ENVIRONMENT',
      value: stack,
    },
    {
      name: 'RUST_LOG',
      value: 'scheduled_action=info,ai=info,ai_tools=info,tower_http=info',
    },
    // Auth
    {
      name: 'JWT_SECRET_KEY',
      value: pulumi.interpolate`${JWT_SECRET_KEY}`,
    },
    {
      name: 'AUDIENCE',
      value: pulumi.interpolate`${FUSIONAUTH_CLIENT_ID}`,
    },
    {
      name: 'ISSUER',
      value: pulumi.interpolate`${FUSIONAUTH_ISSUER}`,
    },
    {
      name: 'MACRO_API_TOKEN_ISSUER',
      value: pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenIssuer}`,
    },
    {
      name: 'MACRO_API_TOKEN_PUBLIC_KEY',
      value: pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenPublicKey}`,
    },
    // Queues
    {
      name: 'NOTIFICATION_QUEUE',
      value: pulumi.interpolate`${notificationIngressQueueName}`,
    },
    {
      name: 'EMAIL_SCHEDULED_QUEUE',
      value: pulumi.interpolate`${emailScheduledQueueName}`,
    },
    // Tool context: internal service URLs
    {
      name: 'INTERNAL_API_SECRET_KEY',
      value: INTERNAL_AUTH_KEY_NAME,
    },
    {
      name: 'CONNECTION_GATEWAY_URL',
      value: `https://connection-gateway${
        stack === 'prod' ? '' : `-${stack}`
      }.macro.com`,
    },
    {
      name: 'DOCUMENT_STORAGE_SERVICE_URL',
      value: pulumi.interpolate`${documentStorageServiceUrl}`,
    },
    {
      name: 'SEARCH_SERVICE_URL',
      value: pulumi.interpolate`${documentStorageServiceUrl}`,
    },
    {
      name: 'SYNC_SERVICE_URL',
      value: `https://sync-service-${stack === 'dev' ? 'dev3' : 'prod2'}.macroverse.workers.dev`,
    },
    {
      name: 'LEXICAL_SERVICE_URL',
      value: `https://lexical-service-${stack}.macroverse.workers.dev`,
    },
    {
      name: 'EMAIL_SERVICE_URL',
      value: `https://email-service${stack === 'prod' ? '' : `-${stack}`}.macro.com`,
    },
    {
      name: 'STATIC_FILE_SERVICE_URL',
      value: `https://static-file-service${stack === 'prod' ? '' : `-${stack}`}.macro.com`,
    },
    // Tool context: storage
    {
      name: 'DOCUMENT_STORAGE_BUCKET',
      value: pulumi.interpolate`${documentStorageBucketId}`,
    },
    {
      name: 'DOCX_DOCUMENT_UPLOAD_BUCKET',
      value: pulumi.interpolate`${docxUploadBucketName}`,
    },
    {
      name: 'DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL',
      value: pulumi.interpolate`${cloudfrontDistributionUrl}`,
    },
    {
      name: 'DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID',
      value: pulumi.interpolate`${cloudfrontSignerPublicKeyId}`,
    },
    {
      name: 'DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME',
      value: CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME,
    },
    // AI model API keys
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
      name: 'PERPLEXITY_API_KEY',
      value: pulumi.interpolate`${PERPLEXITY_API_KEY}`,
    },
    // Datadog
    {
      name: 'DD_SERVICE',
      value: 'agent-schedule-service',
    },
    {
      name: 'DD_ENV',
      value: stack,
    },
  ],
});

export const agentScheduleServiceUrl = pulumi.interpolate`${service.domain}`;
