import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Queue } from '@resources';
import { config, getMacroApiToken, stack } from '@shared';
import { get_coparse_api_vpc } from '@vpc';
import { InsightService } from './service';

const project = 'insight-service';

const tags = {
  environment: stack,
  tech_lead: 'ehayes',
  project,
};

const contextQueue = new Queue(project, {
  tags,
  maxReceiveCount: 2,
  fifoQueue: true,
});

export const contextQueueArn = contextQueue.queue.arn;
export const contextQueueName = contextQueue.queue.name;

const MACRODB_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_secret_key`),
  })
  .apply((secret) => secret.secretString);

const coparse_api_vpc = get_coparse_api_vpc();

type InsightServiceEnvVars = {
  MACRODB_URL: pulumi.Output<string> | string;
  ENVIRONMENT: pulumi.Output<string> | string;
  RUST_LOG: pulumi.Output<string> | string;
  INSIGHT_CONTEXT_QUEUE: pulumi.Output<string> | string;
  OPEN_ROUTER_API_KEY: pulumi.Output<string> | string;
  AUDIENCE: pulumi.Output<string> | string;
  ISSUER: pulumi.Output<string> | string;
  JWT_SECRET_KEY: pulumi.Output<string> | string;
  SERVICE_INTERNAL_AUTH_KEY: pulumi.Output<string> | string;
  DOCUMENT_STORAGE_SERVICE_URL: pulumi.Output<string> | string;
  DOCUMENT_COGNITION_SERVICE_URL: pulumi.Output<string> | string;
  SYNC_SERVICE_AUTH_KEY: pulumi.Output<string> | string;
  SYNC_SERVICE_URL: pulumi.Output<string> | string;
  EMAIL_SERVICE_URL: pulumi.Output<string> | string;
  MACRO_API_TOKEN_ISSUER: pulumi.Output<string> | string;
  MACRO_API_TOKEN_PUBLIC_KEY: pulumi.Output<string> | string;
  LEXICAL_SERVICE_URL: pulumi.Output<string> | string;
};
const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const cloudStorageClusterArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterArn')
  .apply((arn) => arn as string);

const OPEN_ROUTER_API_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('open-router-api-key'),
  })
  .apply((secret) => secret.secretString);

const JWT_SECRET_KEY = config.require(`jwt_secret_key`);
const fusionauthClientIdSecretKey = config.require(`fusionauth_client_id`);

const FUSIONAUTH_CLIENT_ID = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: fusionauthClientIdSecretKey,
  })
  .apply((secret) => secret.secretString);
const FUSIONAUTH_ISSUER = config.require(`fusionauth_issuer`);

const SERVICE_INTERNAL_AUTH_KEY_KEY = config.require(
  `service_internal_auth_key`
);
const SERVICE_INTERNAL_AUTH_KEY: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: SERVICE_INTERNAL_AUTH_KEY_KEY })
  .apply((secret) => secret.secretString);

const SYNC_SERVICE_AUTH_KEY = config.require(`sync_service_auth_key`);
const syncServiceAuthKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: SYNC_SERVICE_AUTH_KEY })
  .apply((secret) => secret.arn);

const DOCUMENT_STORAGE_SERVICE_URL = `https://cloud-storage${stack === 'prod' ? '' : `-${stack}`}.macro.com`;
const DOCUMENT_COGNITION_SERVICE_URL = `https://document-cognition${stack === 'prod' ? '' : `-${stack}`}.macro.com`;

// NOTE: from email-service-stack, hardcoded to avoid circular dependency
const emailServiceUrl = `https://email-service${stack === 'prod' ? '' : `-${stack}`}.macro.com`;

const MACRO_API_TOKENS = getMacroApiToken();

const vars: InsightServiceEnvVars = {
  MACRODB_URL: pulumi.interpolate`${MACRODB_URL}`,
  ENVIRONMENT: stack,
  RUST_LOG: `insight_service=${stack === 'prod' ? 'info' : 'debug'},ai=${stack === 'prod' ? 'info' : 'debug'}`,
  INSIGHT_CONTEXT_QUEUE: pulumi.interpolate`${contextQueueName}`,
  OPEN_ROUTER_API_KEY: pulumi.interpolate`${OPEN_ROUTER_API_KEY}`,
  JWT_SECRET_KEY: pulumi.interpolate`${JWT_SECRET_KEY}`,
  AUDIENCE: pulumi.interpolate`${FUSIONAUTH_CLIENT_ID}`,
  ISSUER: pulumi.interpolate`${FUSIONAUTH_ISSUER}`,
  SERVICE_INTERNAL_AUTH_KEY: pulumi.interpolate`${SERVICE_INTERNAL_AUTH_KEY}`,
  DOCUMENT_STORAGE_SERVICE_URL,
  DOCUMENT_COGNITION_SERVICE_URL,
  SYNC_SERVICE_AUTH_KEY: pulumi.interpolate`${SYNC_SERVICE_AUTH_KEY}`,
  SYNC_SERVICE_URL: `https://sync-service${stack === 'prod' ? '' : `-${stack}`}.macroverse.workers.dev`,
  EMAIL_SERVICE_URL: pulumi.interpolate`${emailServiceUrl}`,
  MACRO_API_TOKEN_ISSUER: pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenIssuer}`,
  MACRO_API_TOKEN_PUBLIC_KEY: pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenPublicKey}`,
  LEXICAL_SERVICE_URL: `https://lexical-service-${stack}.macroverse.workers.dev`,
};

const insightGenerationServiceEnvVars = Object.entries(vars).map(([k, v]) => ({
  name: k,
  value: v,
}));

const jwtSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

const secretKeyArns = [
  jwtSecretKeyArn,
  syncServiceAuthKeyArn,
  MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
];

new InsightService(`insight-service-${stack}`, {
  ecsClusterArn: cloudStorageClusterArn,
  vpc: coparse_api_vpc,
  platform: {
    family: 'linux',
    architecture: 'amd64',
  },
  queueArn: contextQueueArn,
  envVars: insightGenerationServiceEnvVars,
  tags,
  secretKeyArns,
  port: 8080,
});
