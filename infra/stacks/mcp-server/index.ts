import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import {
  config,
  getAiToolsInfra,
  getMacroApiToken,
  stack,
} from '../../packages/shared';
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

// Base URL of the Macro web app, used to build links to Macro items in MCP
// responses. Consumed by mcp_service as the `APP_BASE_URL` env var.
const APP_BASE_URL = config.require('app_base_url');

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

const MACRO_CACHE = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_cache_secret_key`),
  })
  .apply((secret) => secret.secretString);

const MACRO_API_TOKENS = getMacroApiToken();

// ── AI tools infra ───────────────────────────────────────────────────────────

const aiTools = getAiToolsInfra();

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
    fusionauthClientSecretArn,
    fusionauthApiKeyArn,
    googleClientSecretArn,
    MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
    ...aiTools.secretArns,
  ],
  queueArns: [...aiTools.queueArns],
  bucketArns: [...aiTools.bucketArns],
  serviceContainerPort: 8080,
  healthCheckPath: '/health',
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
      value: 'info',
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
    {
      name: 'APP_BASE_URL',
      value: APP_BASE_URL,
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
      name: 'REDIS_URL',
      value: pulumi.interpolate`redis://${MACRO_CACHE}`,
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
