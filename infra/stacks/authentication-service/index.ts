import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import {
  config,
  getMacroApiToken,
  getMacroNotify,
  getSearchEventQueue,
  stack,
} from '@shared';
import { get_coparse_api_vpc } from '@vpc';
import { AuthenticationService } from './service';
import { UserLinkCleanupHandler } from './user-link-cleanup-lambda';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'authentication-service',
};

const DATABASE_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_secret_key`),
  })
  .apply((secret) => secret.secretString);

const MACRO_CACHE = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_cache_secret_key`),
  })
  .apply((secret) => secret.secretString);

const JWT_SECRET_KEY = config.require(`jwt_secret_key`);
const FUSIONAUTH_API_KEY_SECRET_KEY = config.require(
  `fusionauth_api_key_secret_key`
);
const AUTHENTICATION_SERVICE_INTERNAL_API_KEY = config.require(
  `authentication_service_internal_api_key`
);

const SERVICE_INTERNAL_AUTH_KEY_KEY = config.require(
  `service_internal_auth_key`
);

const FUSIONAUTH_CLIENT_SECRET_KEY = config.require(
  `fusionauth_client_secret_key`
);
const STRIPE_SECRET_KEY = config.require(`stripe_secret_key`);
const fusionauthClientIdSecretKey = config.require(`fusionauth_client_id`);

const FUSIONAUTH_CLIENT_ID = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: fusionauthClientIdSecretKey,
  })
  .apply((secret) => secret.secretString);
const FUSIONAUTH_ISSUER = config.require(`fusionauth_issuer`);
const FUSIONAUTH_BASE_URL = `https://${FUSIONAUTH_ISSUER}`;
const GOOGLE_CLIENT_SECRET_KEY = config.require(`google_client_secret_key`);
const googleClientId = config.require(`google_client_id`);
const GOOGLE_CLIENT_ID = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: googleClientId,
  })
  .apply((secret) => secret.secretString);

// Using the 5 secret names
// We need to grab their arns so we can create a policy to allow them to be retrieved by service
const jwtSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

const fusionauthApiKeySecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: FUSIONAUTH_API_KEY_SECRET_KEY })
  .apply((secret) => secret.arn);

const authenticationServiceInternalApiKeyArn: pulumi.Output<string> =
  aws.secretsmanager
    .getSecretVersionOutput({
      secretId: AUTHENTICATION_SERVICE_INTERNAL_API_KEY,
    })
    .apply((secret) => secret.arn);

const SERVICE_INTERNAL_AUTH_KEY: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: SERVICE_INTERNAL_AUTH_KEY_KEY })
  .apply((secret) => secret.secretString);

const fusionauthClientSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: FUSIONAUTH_CLIENT_SECRET_KEY })
  .apply((secret) => secret.arn);

const stripeSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: STRIPE_SECRET_KEY })
  .apply((secret) => secret.arn);

const googleClientSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: GOOGLE_CLIENT_SECRET_KEY })
  .apply((secret) => secret.arn);

const MACRO_API_TOKEN_PRIVATE_SECRET_KEY = config.require(
  `macro_api_token_private_secret_key`
);
const macroApiTokenSecretPrivateKeyArn: pulumi.Output<string> =
  aws.secretsmanager
    .getSecretVersionOutput({ secretId: MACRO_API_TOKEN_PRIVATE_SECRET_KEY })
    .apply((secret) => secret.arn);

const stripeWebhookSecretKey = config.require(`stripe_webhook_secret_key`);
const stripeWebhookSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: stripeWebhookSecretKey })
  .apply((secret) => secret.arn);

const MACRO_API_TOKENS = getMacroApiToken();

const secretKeyArns = [
  pulumi.interpolate`${jwtSecretKeyArn}`,
  pulumi.interpolate`${fusionauthApiKeySecretKeyArn}`,
  pulumi.interpolate`${authenticationServiceInternalApiKeyArn}`,
  pulumi.interpolate`${fusionauthClientSecretKeyArn}`,
  pulumi.interpolate`${stripeSecretKeyArn}`,
  pulumi.interpolate`${googleClientSecretKeyArn}`,
  pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenPublicKeyArn}`,
  pulumi.interpolate`${macroApiTokenSecretPrivateKeyArn}`,
  pulumi.interpolate`${stripeWebhookSecretKeyArn}`,
];

const vpc = get_coparse_api_vpc();

const fusionAuthStack = new pulumi.StackReference('fusion-auth-stack', {
  name: `macro-inc/fusion-auth/${stack}`,
});

const fusionAuthClusterArn: pulumi.Output<string> = fusionAuthStack
  .getOutput('fusionAuthClusterArn')
  .apply((fusionAuthClusterArn) => fusionAuthClusterArn as string);

const fusionAuthClusterName: pulumi.Output<string> = fusionAuthStack
  .getOutput('fusionAuthClusterName')
  .apply((fusionAuthClusterName) => fusionAuthClusterName as string);

const { notificationQueueName, notificationQueueArn } = getMacroNotify();

const { searchEventQueueName, searchEventQueueArn } = getSearchEventQueue();

const service = new AuthenticationService('authentication-service', {
  secretKeyArns,
  clusterName: fusionAuthClusterName,
  ecsClusterArn: fusionAuthClusterArn,
  vpc,
  platform: {
    family: 'linux',
    architecture: 'amd64',
  },
  serviceContainerPort: 8080,
  isPrivate: false,
  healthCheckPath: '/health',
  tags,
  queueArns: [notificationQueueArn, searchEventQueueArn],
  containerEnvVars: [
    { name: 'ENVIRONMENT', value: stack },
    {
      name: 'RUST_LOG',
      value: `authentication_service=${stack === 'prod' ? 'info' : 'trace'},tower_http=${stack === 'prod' ? 'info' : 'debug'},macro_auth=${stack === 'prod' ? 'info' : 'debug'},macro_middleware=${stack === 'prod' ? 'info' : 'debug'}`,
    },
    {
      name: 'DATABASE_URL',
      value: pulumi.interpolate`${DATABASE_URL}`,
    },
    {
      name: 'REDIS_URI',
      value: pulumi.interpolate`redis://${MACRO_CACHE}`,
    },
    {
      name: 'FUSIONAUTH_API_KEY_SECRET_KEY',
      value: pulumi.interpolate`${FUSIONAUTH_API_KEY_SECRET_KEY}`,
    },
    {
      name: 'FUSIONAUTH_CLIENT_SECRET_KEY',
      value: pulumi.interpolate`${FUSIONAUTH_CLIENT_SECRET_KEY}`,
    },
    {
      name: 'FUSIONAUTH_APPLICATION_ID',
      value: pulumi.interpolate`${FUSIONAUTH_CLIENT_ID}`,
    },
    { name: 'ISSUER', value: pulumi.interpolate`${FUSIONAUTH_ISSUER}` },
    {
      name: 'JWT_SECRET_KEY',
      value: pulumi.interpolate`${JWT_SECRET_KEY}`,
    },
    {
      name: 'INTERNAL_API_SECRET_KEY',
      value: pulumi.interpolate`${AUTHENTICATION_SERVICE_INTERNAL_API_KEY}`,
    },
    {
      name: 'FUSIONAUTH_BASE_URL',
      value: pulumi.interpolate`${FUSIONAUTH_BASE_URL}`,
    },
    {
      name: 'FUSIONAUTH_CLIENT_ID',
      value: pulumi.interpolate`${FUSIONAUTH_CLIENT_ID}`,
    },
    {
      name: 'STRIPE_SECRET_KEY',
      value: pulumi.interpolate`${STRIPE_SECRET_KEY}`,
    },
    {
      name: 'GOOGLE_CLIENT_ID',
      value: pulumi.interpolate`${GOOGLE_CLIENT_ID}`,
    },
    {
      name: 'GOOGLE_CLIENT_SECRET_KEY',
      value: pulumi.interpolate`${GOOGLE_CLIENT_SECRET_KEY}`,
    },
    {
      name: 'AUDIENCE',
      value: pulumi.interpolate`${FUSIONAUTH_CLIENT_ID}`,
    },
    {
      name: 'SERVICE_INTERNAL_AUTH_KEY',
      value: pulumi.interpolate`${SERVICE_INTERNAL_AUTH_KEY}`,
    },
    {
      name: 'COMMS_SERVICE_URL',
      value: `https://comms-service${
        stack === 'prod' ? '' : `-${stack}`
      }.macro.com`,
    },
    {
      name: 'DOCUMENT_STORAGE_SERVICE_URL',
      value: `https://cloud-storage${
        stack === 'prod' ? '' : `-${stack}`
      }.macro.com`,
    },
    {
      name: 'NOTIFICATION_SERVICE_URL',
      value: `https://notifications${
        stack === 'prod' ? '' : `-${stack}`
      }.macro.com`,
    },
    {
      name: 'PROPERTIES_SERVICE_URL',
      value: `https://properties-service${
        stack === 'prod' ? '' : `-${stack}`
      }.macro.com`,
    },
    {
      name: 'NOTIFICATION_QUEUE',
      value: pulumi.interpolate`${notificationQueueName}`,
    },
    {
      name: 'SEARCH_EVENT_QUEUE',
      value: pulumi.interpolate`${searchEventQueueName}`,
    },
    {
      name: 'MACRO_API_TOKEN_ISSUER',
      value: pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenIssuer}`,
    },
    {
      name: 'MACRO_API_TOKEN_PUBLIC_KEY',
      value: pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenPublicKey}`,
    },
    {
      name: 'MACRO_API_TOKEN_PRIVATE_SECRET_KEY',
      value: pulumi.interpolate`${macroApiTokenSecretPrivateKeyArn}`,
    },
    {
      name: 'STRIPE_WEBHOOK_SECRET_KEY',
      value: pulumi.interpolate`${stripeWebhookSecretKeyArn}`,
    },
  ],
});

new UserLinkCleanupHandler('user-link-cleanup-handler', {
  envVars: {
    DATABASE_URL: pulumi.interpolate`${DATABASE_URL}`,
    ENVIRONMENT: stack,
    RUST_LOG: 'user_link_cleanup_handler=info',
  },
  vpc,
  tags,
});

export const authenticationServiceUrl = pulumi.interpolate`${service.domain}`;
