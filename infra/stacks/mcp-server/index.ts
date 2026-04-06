import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, getMacroApiToken, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { McpServer, SERVICE_DOMAIN_NAME } from './mcp-server';

const tags = {
  environment: stack,
  env: stack,
  tech_lead: 'ehayes',
  project: 'mcp-server',
  service: 'mcp-server',
};

// ── Secrets ──────────────────────────────────────────────────────────────────

const DATABASE_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('macro_db_secret_key'),
  })
  .apply((secret) => secret.secretString);

const SYNC_SERVICE_AUTH_KEY = config.require('sync_service_auth_key');
const syncServiceAuthKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: SYNC_SERVICE_AUTH_KEY })
  .apply((secret) => secret.arn);

const JWT_SECRET_KEY = config.require('jwt_secret_key');
const jwtSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

const fusionauthClientIdSecretKey = config.require('fusionauth_client_id');
const FUSIONAUTH_CLIENT_ID = aws.secretsmanager
  .getSecretVersionOutput({ secretId: fusionauthClientIdSecretKey })
  .apply((secret) => secret.secretString);

const FUSIONAUTH_BASE_URL = config.require('fusionauth_base_url');
const FUSIONAUTH_ISSUER = config.require('fusionauth_issuer');

const FUSIONAUTH_CLIENT_SECRET = config.require('fusionauth_client_secret');
const fusionauthClientSecretArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: FUSIONAUTH_CLIENT_SECRET })
  .apply((secret) => secret.arn);

const FUSIONAUTH_TENANT_ID = config.require('fusionauth_tenant_id');

const FUSIONAUTH_API_KEY = config.require('fusionauth_api_key');
const fusionauthApiKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: FUSIONAUTH_API_KEY })
  .apply((secret) => secret.arn);

const googleClientIdSecretKey = config.require('google_client_id');
const GOOGLE_CLIENT_ID = aws.secretsmanager
  .getSecretVersionOutput({ secretId: googleClientIdSecretKey })
  .apply((secret) => secret.secretString);

const GOOGLE_CLIENT_SECRET = config.require('google_client_secret');
const googleClientSecretArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: GOOGLE_CLIENT_SECRET })
  .apply((secret) => secret.arn);

const INTERNAL_AUTH_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('internal_auth_key'),
  })
  .apply((secret) => secret.secretString);

const MACRO_API_TOKENS = getMacroApiToken();

// ── Stack references ─────────────────────────────────────────────────────────

export const coparse_api_vpc = get_coparse_api_vpc();

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const cloudStorageClusterArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterArn')
  .apply((arn) => arn as string);

const cloudStorageClusterName: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterName')
  .apply((arn) => arn as string);

const documentStorageBucketId: pulumi.Output<string> = cloudStorageStack
  .getOutput('documentStorageBucketId')
  .apply((id) => id as string);

const documentStorageBucketArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('documentStorageBucketArn')
  .apply((arn) => arn as string);

const cloudStorageServiceStack = new pulumi.StackReference(
  'cloud-storage-service',
  {
    name: `macro-inc/cloud-storage-service/${stack}`,
  }
);

const emailServiceStack = new pulumi.StackReference('email-service-stack', {
  name: `macro-inc/email-service/${stack}`,
});

export const documentStorageServiceUrl: pulumi.Output<string> =
  cloudStorageServiceStack
    .getOutput('cloudStorageServiceUrl')
    .apply((url) => url as string);

const docxUploadBucketName: pulumi.Output<string> = cloudStorageServiceStack
  .getOutput('docxUploadBucketName')
  .apply((name) => name as string);

const docxUploadBucketArn: pulumi.Output<string> = cloudStorageServiceStack
  .getOutput('docxUploadBucketArn')
  .apply((arn) => arn as string);

const emailScheduledQueueArn: pulumi.Output<string> = emailServiceStack
  .getOutput('scheduledQueueArn')
  .apply((arn) => arn as string);

const emailScheduledQueueName: pulumi.Output<string> = emailServiceStack
  .getOutput('scheduledQueueName')
  .apply((name) => name as string);

const linksharingStack = new pulumi.StackReference('linksharing-stack', {
  name: `macro-inc/link-sharing/${stack}`,
});

const cloudfrontDistributionUrl: pulumi.Output<string> = linksharingStack
  .getOutput('cloudfrontDistributionUrl')
  .apply((url) => url as string);

const cloudfrontSignerPublicKeyId: pulumi.Output<string> = linksharingStack
  .getOutput('cloudfrontDistributionPublicKeyId')
  .apply((key) => key as string);

const CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME = `linksharing-private-key-${stack}`;

const cloudfrontPrivateKeySecretArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretOutput({
    name: CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME,
  })
  .apply((secret) => secret.arn);

// ── Service ──────────────────────────────────────────────────────────────────

const mcpServer = new McpServer(`mcp-server-${stack}`, {
  ecsClusterArn: cloudStorageClusterArn,
  cloudStorageClusterName,
  vpc: coparse_api_vpc,
  platform: {
    family: 'linux',
    architecture: 'amd64',
  },
  secretKeyArns: [
    jwtSecretKeyArn,
    syncServiceAuthKeyArn,
    fusionauthClientSecretArn,
    fusionauthApiKeyArn,
    googleClientSecretArn,
    cloudfrontPrivateKeySecretArn,
    MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
  ],
  queueArns: [emailScheduledQueueArn],
  bucketArns: [documentStorageBucketArn, docxUploadBucketArn],
  serviceContainerPort: 8080,
  healthCheckPath: '/health',
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
      value: 'info',
    },
    {
      name: 'INTERNAL_API_SECRET_KEY',
      value: pulumi.interpolate`${INTERNAL_AUTH_KEY}`,
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
    {
      name: 'DOCX_DOCUMENT_UPLOAD_BUCKET',
      value: pulumi.interpolate`${docxUploadBucketName}`,
    },
    {
      name: 'SYNC_SERVICE_AUTH_KEY',
      value: pulumi.interpolate`${SYNC_SERVICE_AUTH_KEY}`,
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
      value: `https://email-service${
        stack === 'prod' ? '' : `-${stack}`
      }.macro.com`,
    },
    {
      name: 'EMAIL_SCHEDULED_QUEUE',
      value: pulumi.interpolate`${emailScheduledQueueName}`,
    },
    {
      name: 'STATIC_FILE_SERVICE_URL',
      value: `https://static-file-service${
        stack === 'prod' ? '' : `-${stack}`
      }.macro.com`,
    },
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
    // MCP OAuth / FusionAuth
    {
      name: 'MCP_PUBLIC_URL',
      value: `https://${SERVICE_DOMAIN_NAME}`,
    },
    {
      name: 'FUSIONAUTH_BASE_URL',
      value: FUSIONAUTH_BASE_URL,
    },
    {
      name: 'FUSIONAUTH_CLIENT_ID',
      value: pulumi.interpolate`${FUSIONAUTH_CLIENT_ID}`,
    },
    {
      name: 'FUSIONAUTH_CLIENT_SECRET_KEY',
      value: FUSIONAUTH_CLIENT_SECRET,
    },
    {
      name: 'FUSIONAUTH_TENANT_ID',
      value: FUSIONAUTH_TENANT_ID,
    },
    {
      name: 'FUSIONAUTH_API_KEY_SECRET_KEY',
      value: FUSIONAUTH_API_KEY,
    },
    {
      name: 'GOOGLE_CLIENT_ID',
      value: pulumi.interpolate`${GOOGLE_CLIENT_ID}`,
    },
    {
      name: 'GOOGLE_CLIENT_SECRET_KEY',
      value: GOOGLE_CLIENT_SECRET,
    },
    {
      name: 'MACRO_API_TOKEN_ISSUER',
      value: pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenIssuer}`,
    },
    {
      name: 'MACRO_API_TOKEN_PUBLIC_KEY',
      value: pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenPublicKey}`,
    },
    // Datadog
    {
      name: 'DD_SERVICE',
      value: 'mcp-server',
    },
    {
      name: 'DD_ENV',
      value: stack,
    },
  ],
  isPrivate: false,
  tags,
});

export const mcpServerUrl = pulumi.interpolate`${mcpServer.domain}`;
export const mcpServerRoleArn = mcpServer.role.arn;
