import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, getMacroApiToken, stack } from '../../packages/shared';
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
// `main.rs` calls `JwtValidationArgs::new_with_secret_manager`, which fetches
// both of these directly from Secrets Manager at runtime - same code path as
// agent-schedule-service and connection-gateway. The service's own secrets
// (DAYTONA_API_KEY, GITHUB_TOKEN, HARNESS_BOT_ID, INTERNAL_API_KEY,
// DATABASE_URL, ...) arrive through the Doppler-synced APP_SECRETS_JSON.

const JWT_SECRET_KEY = config.require('jwt_secret_key');
const jwtSecretKeyArn = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

const MACRO_API_TOKENS = getMacroApiToken();

const MACRO_DB_URL = config.require('macro_db_secret_key');
const macroDbUrlArn = aws.secretsmanager
  .getSecretVersionOutput({ secretId: MACRO_DB_URL })
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

const kafkaClusterStack = new pulumi.StackReference(
  'kafka-cluster-brokers-stack',
  {
    name: `macro-inc/kafka-cluster/${stack}`,
  }
);

const kafkaBrokers = kafkaClusterStack
  .getOutput('bootstrapBrokersSaslIam')
  .apply((brokers) => brokers as string);

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
  secretKeyArns: [
    jwtSecretKeyArn,
    MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
    macroDbUrlArn,
  ],
  sendQueueArns: [notificationIngressQueueArn, contactsQueueArn],
  containerEnvVars: [
    {
      name: 'ENVIRONMENT',
      value: stack,
    },
    {
      name: 'KAFKA_BROKERS',
      value: kafkaBrokers,
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
