import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, getMacroApiToken, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { AgentProxyService } from './agent_proxy_service';

const tags = {
  environment: stack,
  env: stack,
  tech_lead: 'ehayes',
  project: 'agent-proxy-service',
  service: 'agent-proxy-service',
};

// ── Secrets ──────────────────────────────────────────────────────────────────
// `main.rs` calls `JwtValidationArgs::new_with_secret_manager`, which fetches
// both of these directly from Secrets Manager at runtime - same code path as
// agent-schedule-service and connection-gateway.

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

// ── Service ──────────────────────────────────────────────────────────────────

const vpc = get_coparse_api_vpc();

const service = new AgentProxyService(`agent-proxy-service-${stack}`, {
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
    macroDbUrlArn,
  ],
  containerEnvVars: [
    {
      name: 'ENVIRONMENT',
      value: stack,
    },
    // Datadog
    {
      name: 'DD_SERVICE',
      value: 'agent-proxy-service',
    },
    {
      name: 'DD_ENV',
      value: stack,
    },
  ],
});

export const agentProxyServiceUrl = pulumi.interpolate`${service.domain}`;
export const agentProxyServiceRoleArn = service.role.arn;
