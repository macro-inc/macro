import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { getMacroApiToken, stack } from '../../packages/shared';
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
// Config (DATABASE_URL, DAYTONA_API_KEY, KAFKA_BROKERS, ...) arrives through
// the Doppler-synced APP_SECRETS_JSON. Doppler's JWT_SECRET_KEY and
// MACRO_API_TOKEN_PUBLIC_KEY hold Secrets Manager secret *names* that
// `JwtValidationArgs::new_with_secret_manager` resolves at runtime
// (crates/remote_env_var), so the task role needs read access to those two
// secrets - the same code path as agent-schedule-service and
// connection-gateway.

const jwtSecretKeyArn = aws.secretsmanager
  .getSecretVersionOutput({ secretId: `fusionauth-jwt-secret-${stack}` })
  .apply((secret) => secret.arn);

const MACRO_API_TOKENS = getMacroApiToken();

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
// Channel side effects fan out over these; names match `macro_queues`.

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
  healthCheckPath: '/health',
  isPrivate: false,
  ecsClusterArn: cloudStorageClusterArn,
  cloudStorageClusterName,
  secretKeyArns: [jwtSecretKeyArn, MACRO_API_TOKENS.macroApiTokenPublicKeyArn],
  sendQueueArns: [notificationIngressQueueArn, contactsQueueArn],
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
export const agentHarnessServiceRoleArn = service.role.arn;
