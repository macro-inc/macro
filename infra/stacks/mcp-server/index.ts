import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import {
  config,
  getAiToolsInfra,
  getMacroApiToken,
  stack,
} from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { McpServer } from './mcp-server';

const tags = {
  environment: stack,
  env: stack,
  tech_lead: 'ehayes',
  project: 'mcp-server',
  service: 'mcp-server',
};

// ── Secrets ──────────────────────────────────────────────────────────────────

const JWT_SECRET_KEY = config.require('jwt_secret_key');
const jwtSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

const FUSIONAUTH_CLIENT_SECRET = config.require('fusionauth_client_secret');
const fusionauthClientSecretArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: FUSIONAUTH_CLIENT_SECRET })
  .apply((secret) => secret.arn);

const FUSIONAUTH_API_KEY = config.require('fusionauth_api_key');
const fusionauthApiKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: FUSIONAUTH_API_KEY })
  .apply((secret) => secret.arn);

const GOOGLE_CLIENT_SECRET = config.require('google_client_secret');
const googleClientSecretArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: GOOGLE_CLIENT_SECRET })
  .apply((secret) => secret.arn);

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
