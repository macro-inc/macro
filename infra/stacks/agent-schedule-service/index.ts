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

const JWT_SECRET_KEY = config.require('jwt_secret_key');
const jwtSecretKeyArn = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

const MACRO_API_TOKENS = getMacroApiToken();
const { notificationIngressQueueArn } = getMacroNotify();

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
    {
      name: 'ENVIRONMENT',
      value: stack,
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
