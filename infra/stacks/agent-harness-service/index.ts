import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import * as doppler from '@pulumiverse/doppler';
import { createBucket } from '../../packages/resources';
import {
  AGENT_PUBLIC_URLS,
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

// Pull request patches are shared with cloud-storage-service, which owns the
// bucket; a session capture reuses the patch a pull request viewer stored.
const cloudStorageServiceStack = new pulumi.StackReference(
  'cloud-storage-service-stack',
  { name: `macro-inc/cloud-storage-service/${stack}` }
);

const githubPullRequestPatchBucketArn = cloudStorageServiceStack
  .getOutput('githubPullRequestPatchBucketArn')
  .apply((value) => value as string);

const githubPullRequestPatchBucketName = cloudStorageServiceStack
  .getOutput('githubPullRequestPatchBucketName')
  .apply((value) => value as string);

// ── Service ──────────────────────────────────────────────────────────────────

const vpc = get_coparse_api_vpc();

const preview = new pulumi.StackReference('preview-network', {
  name: `macro-inc/preview-gateway/${stack}`,
});
const cognition = new pulumi.StackReference('cognition-resources', {
  name: `macro-inc/document-cognition/${stack}`,
});
const connection = new pulumi.StackReference('connection-resources', {
  name: `macro-inc/connection-gateway/${stack}`,
});
const extractor = new pulumi.StackReference('text-extractor-resources', {
  name: `macro-inc/document-text-extractor/${stack}`,
});
const fusionauthSecretArns = [
  'fusionauth-client-secret',
  'fusionauth-api-key',
  'google-client-secret',
  'authentication-service-internal-api-key',
].map(
  (name) => aws.secretsmanager.getSecretOutput({ name: `${name}-${stack}` }).arn
);

// Only infrastructure-generated preview addresses are runtime configuration.
const configurationSecrets = Object.entries({
  PREVIEW_DOMAIN: preview.requireOutput('previewDomain'),
  PREVIEW_SSH_HOST: preview.requireOutput('previewSshHost'),
}).map(
  ([key, value]) =>
    new doppler.Secret(`harness-${key}-${stack}`, {
      project: 'agent-harness-service',
      config: stack === 'prod' ? 'prd' : 'dev',
      name: key,
      value,
    })
);

// Retain the previous binary's required keys through this rolling deployment
// and automatic rollback. The harness no longer reads these mirrors. After this
// version is the rollback baseline, remove these resources; retainOnDelete keeps
// that later removal from deleting values still needed by historical images.
const legacyUrlSecrets = Object.entries({
  PREVIEW_APP_ORIGIN: getServiceUrl(ServiceUrl.APP_SERVICE_URL),
  PREVIEW_CONTROL_HOSTS: new URL(getServiceUrl(ServiceUrl.PREVIEW_GATEWAY_URL))
    .hostname,
  MCP_PUBLIC_URL: AGENT_PUBLIC_URLS.mcp,
  MCP_CLIENT_PUBLIC_URL: AGENT_PUBLIC_URLS.cognition,
}).map(
  ([key, value]) =>
    new doppler.Secret(
      `harness-${key}-${stack}`,
      {
        project: 'agent-harness-service',
        config: stack === 'prod' ? 'prd' : 'dev',
        name: key,
        value,
      },
      { retainOnDelete: true, ignoreChanges: ['value'] }
    )
);
configurationSecrets.push(...legacyUrlSecrets);

const service = new AgentHarnessService(
  `agent-harness-service-${stack}`,
  {
    vpc,
    tags,
    previewSecurityGroupId: preview.requireOutput('previewTaskSecurityGroupId'),
    previewControlTargetGroupArn: preview.requireOutput(
      'previewControlTargetGroupArn'
    ),
    previewHttpTargetGroupArn: preview.requireOutput(
      'previewHttpTargetGroupArn'
    ),
    previewSshTargetGroupArn: preview.requireOutput('previewSshTargetGroupArn'),
    platform: { family: 'linux', architecture: 'amd64' },
    serviceContainerPort: 8101,
    configurationSecrets,
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
      ...fusionauthSecretArns,
    ],
    projectionQueueArn: cognition.requireOutput('aiProjectionQueueArn'),
    queueArns: [
      ...aiTools.queueArns,
      cognition.requireOutput('aiProjectionQueueArn'),
      cloudStorageServiceStack.requireOutput('deleteChatQueueArn'),
      extractor.requireOutput('documentTextExtractorLambdaQueueArn'),
    ],
    bucketArns: [
      ...aiTools.bucketArns,
      sessionChangesBucket.arn,
      githubPullRequestPatchBucketArn,
    ],
    containerEnvVars: [
      { name: 'DENO_BINARY', value: '/usr/local/bin/deno' },
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
      {
        name: 'GITHUB_PULL_REQUEST_PATCH_BUCKET',
        value: githubPullRequestPatchBucketName,
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
  },
  { dependsOn: configurationSecrets }
);

export const agentHarnessServiceUrl = getServiceUrl(
  ServiceUrl.AGENT_HARNESS_SERVICE_URL
);
export const agentHarnessEgressUrl = pulumi.interpolate`${service.egressDomain}`;
export const agentHarnessServiceRoleArn = service.role.arn;

new aws.iam.RolePolicyAttachment('harness-connection-table', {
  role: service.role.name,
  policyArn: connection.requireOutput('connectionGatewayTablePolicyArn'),
});
