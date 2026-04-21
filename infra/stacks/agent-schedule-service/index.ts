import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import {
  config,
  getAiToolsInfra,
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

const MACRO_API_TOKENS = getMacroApiToken();
const { notificationIngressQueueArn, notificationIngressQueueName } =
  getMacroNotify();

// ── AI tools infra ───────────────────────────────────────────────────────────

const aiTools = getAiToolsInfra();

// ── Stack references ─────────────────────────────────────────────────────────

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const cloudStorageClusterArn = cloudStorageStack
  .getOutput('cloudStorageClusterArn')
  .apply((value) => value as string);

const cloudStorageClusterName = cloudStorageStack
  .getOutput('cloudStorageClusterName')
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
    MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
    ...aiTools.secretArns,
  ],
  queueArns: [notificationIngressQueueArn, ...aiTools.queueArns],
  bucketArns: [...aiTools.bucketArns],
  containerEnvVars: [
    ...aiTools.envVars,
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
    // Service URLs not covered by ai_tools
    {
      name: 'CONNECTION_GATEWAY_URL',
      value: `https://connection-gateway${
        stack === 'prod' ? '' : `-${stack}`
      }.macro.com`,
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
export const agentScheduleServiceRoleArn = service.role.arn;
