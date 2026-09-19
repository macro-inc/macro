import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { createBucket } from '../../packages/resources';
import {
  config,
  CODEX_OAUTH_KMS_ALIAS,
  getAiToolsInfra,
  getMacroApiToken,
  getServiceUrl,
  ServiceUrl,
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

// ── Session changes bucket ───────────────────────────────────────────────────
// The patch behind each agent session's Changes pane, one object per capture
// under `agent-sessions/{session}/changes/`. Only the latest capture is
// reachable from the database; superseded patches are deleted on capture and
// a session's last patch is orphaned when the session is deleted, so the
// lifecycle rule is what reclaims those.

const sessionChangesBucket = createBucket({
  id: `macro-agent-session-changes-${stack}`,
  bucketName: `macro-agent-session-changes-${stack}`,
  transferAcceleration: false,
  enableVersioning: false,
  lifecycleRules: [
    {
      id: 'expire-orphaned-patches',
      enabled: true,
      expiration: { days: 90 },
    },
  ],
  tags,
});

export const agentSessionChangesBucketArn = sessionChangesBucket.arn;

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

const service = new AgentHarnessService(`agent-harness-service-${stack}`, {
  vpc,
  tags,
  platform: { family: 'linux', architecture: 'amd64' },
  serviceContainerPort: 8101,
  egressContainerPort: 8102,
  healthCheckPath: '/health',
  ecsClusterArn: cloudStorageClusterArn,
  cloudStorageClusterName,
  secretKeyArns: [
    jwtSecretKeyArn,
    MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
    macroApiTokenPrivateKeyArn,
    githubSyncAppPemArn,
    ...aiTools.secretArns,
  ],
  queueArns: [...aiTools.queueArns],
  bucketArns: [...aiTools.bucketArns, sessionChangesBucket.arn],
  containerEnvVars: [
    {
      name: 'CODEX_OAUTH_KMS_KEY_ID',
      value: CODEX_OAUTH_KMS_ALIAS,
    },
    {
      name: 'ENVIRONMENT',
      value: stack,
    },
    {
      name: 'AGENT_SESSION_CHANGES_BUCKET',
      value: sessionChangesBucket.bucket,
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

export const agentHarnessServiceUrl = getServiceUrl(
  ServiceUrl.AGENT_HARNESS_SERVICE_URL
);
export const agentHarnessEgressUrl = pulumi.interpolate`${service.egressDomain}`;
export const agentHarnessServiceRoleArn = service.role.arn;
