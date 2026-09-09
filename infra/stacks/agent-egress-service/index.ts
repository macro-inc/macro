import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { AgentEgressService } from './agent_egress_service';

const tags = {
  environment: stack,
  env: stack,
  tech_lead: 'wolf',
  project: 'agent-egress-service',
  service: 'agent-egress-service',
};

// ── Secrets ──────────────────────────────────────────────────────────────────
// Everything else (DATABASE_URL, the Pipedream client id/secret and project,
// the GitHub App client id, the Macro API token issuer) arrives through the
// Doppler-synced APP_SECRETS_JSON. The two values below are Secrets Manager
// secret *names* Doppler hands over, which the service resolves at runtime -
// so the task role needs read access to them.

const githubSyncAppPemArn = aws.secretsmanager
  .getSecretVersionOutput({ secretId: config.require('github_sync_app_pem') })
  .apply((secret) => secret.arn);

const macroApiTokenPrivateKeyArn = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('macro_api_token_private_secret_key'),
  })
  .apply((secret) => secret.arn);

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

const service = new AgentEgressService(`agent-egress-service-${stack}`, {
  vpc,
  tags,
  platform: { family: 'linux', architecture: 'amd64' },
  // Same port the listener used inside the harness task, so the binary's
  // default and the sandbox-side expectations do not have to move at once.
  serviceContainerPort: 8102,
  healthCheckPath: '/health',
  ecsClusterArn: cloudStorageClusterArn,
  cloudStorageClusterName,
  secretKeyArns: [githubSyncAppPemArn, macroApiTokenPrivateKeyArn],
  containerEnvVars: [
    {
      name: 'ENVIRONMENT',
      value: stack,
    },
    // Datadog
    {
      name: 'DD_SERVICE',
      value: 'agent-egress-service',
    },
    {
      name: 'DD_ENV',
      value: stack,
    },
  ],
});

export const agentEgressServiceUrl = pulumi.interpolate`${service.domain}`;
export const agentEgressServiceRoleArn = service.role.arn;
