import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import {
  config,
  getAiToolsInfra,
  getMacroApiToken,
  stack,
} from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { AgentHarnessService } from './agent_harness_service';

const tags = {
  environment: stack,
  env: stack,
  tech_lead: 'wolf',
  project: 'agent-harness-service',
  service: 'agent-harness-service',
};

// ── Secrets ──────────────────────────────────────────────────────────────────
// Config (DATABASE_URL, DAYTONA_API_KEY, KAFKA_BROKERS, AI tool config, ...)
// arrives through the Doppler-synced APP_SECRETS_JSON. Some values hold
// Secrets Manager secret *names* that the service resolves at runtime, so the
// task role needs access to both its auth secrets and the shared AI tool
// secrets.

const jwtSecretKeyArn = aws.secretsmanager
  .getSecretVersionOutput({ secretId: `fusionauth-jwt-secret-${stack}` })
  .apply((secret) => secret.arn);

// The egress proxy mints GitHub App installation tokens and Macro API tokens
// inline, so the task role needs the App's PEM and the signing key - both
// held as Secrets Manager secret names the service resolves at runtime.
const githubSyncAppPemArn = aws.secretsmanager
  .getSecretVersionOutput({ secretId: config.require('github_sync_app_pem') })
  .apply((secret) => secret.arn);

const macroApiTokenPrivateKeyArn = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('macro_api_token_private_secret_key'),
  })
  .apply((secret) => secret.arn);

const MACRO_API_TOKENS = getMacroApiToken();

// ── AI tools infra ───────────────────────────────────────────────────────────

const aiTools =
  stack === 'dev'
    ? getAiToolsInfra()
    : { secretArns: [], queueArns: [], bucketArns: [] };

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

// ── Queues ───────────────────────────────────────────────────────────────────
// Channel side effects use these in every environment. Dev's AI tool bundle
// includes both plus the additional tool queues.

const notificationIngressQueueArn = aws.sqs
  .getQueueOutput({ name: `notification-ingress-queue-${stack}` })
  .apply((queue) => queue.arn);

const contactsQueueArn = aws.sqs
  .getQueueOutput({ name: `contacts-queue-${stack}` })
  .apply((queue) => queue.arn);

// ── Service ──────────────────────────────────────────────────────────────────

const vpc = get_coparse_api_vpc();

const service = new AgentHarnessService(`agent-harness-service-${stack}`, {
  vpc,
  tags,
  platform: { family: 'linux', architecture: 'amd64' },
  serviceContainerPort: 8101,
  egressContainerPort: 8102,
  healthCheckPath: '/health',
  isPrivate: false,
  ecsClusterArn: cloudStorageClusterArn,
  cloudStorageClusterName,
  secretKeyArns: [
    jwtSecretKeyArn,
    MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
    macroApiTokenPrivateKeyArn,
    githubSyncAppPemArn,
    ...aiTools.secretArns,
  ],
  queueArns:
    stack === 'dev'
      ? [...aiTools.queueArns]
      : [notificationIngressQueueArn, contactsQueueArn],
  bucketArns: [...aiTools.bucketArns],
  containerEnvVars: [
    {
      name: 'ENVIRONMENT',
      value: stack,
    },
    // Datadog
    {
      name: 'DD_SERVICE',
      value: 'agent-harness-service',
    },
    {
      name: 'DD_ENV',
      value: stack,
    },
  ],
});

export const agentHarnessServiceUrl = pulumi.interpolate`${service.domain}`;
export const agentHarnessEgressUrl = pulumi.interpolate`${service.egressDomain}`;
export const agentHarnessServiceRoleArn = service.role.arn;
