import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import {
  config,
  getLinkManagerQueue,
  getMacroApiToken,
  getMacroNotify,
  getSearchEventQueue,
  getServiceUrl,
  ServiceUrl,
  stack,
} from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
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

const GITHUB_CLIENT_ID = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`github_client_id_key`),
  })
  .apply((secret) => secret.secretString);

const GITHUB_CLIENT_SECRET = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`github_client_secret_key`),
  })
  .apply((secret) => secret.secretString);

const GITHUB_IDP_ID = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`github_idp_id_key`),
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

const FUSIONAUTH_TENANT_ID = config.require('fusionauth_tenant_id');

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

// -- STRIPE PRICE IDs
const STRIPE_PRICE_ID_HAIKU = aws.secretsmanager
  .getSecretVersionOutput({ secretId: config.require('stripe_price_id_haiku') })
  .apply((s) => s.secretString);

const STRIPE_PRICE_ID_SONNET = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('stripe_price_id_sonnet'),
  })
  .apply((s) => s.secretString);

const STRIPE_PRICE_ID_OPUS = aws.secretsmanager
  .getSecretVersionOutput({ secretId: config.require('stripe_price_id_opus') })
  .apply((s) => s.secretString);

const MACRO_API_TOKEN_EXPIRY_SECONDS = config.require(
  `macro_api_token_expiry_seconds`
);

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

const GA_ANALYTICS_MEASUREMENT_ID = config.require('ga_measurement_id');

const GA_API_SECRET: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: config.require('ga_api_secret') })
  .apply((secret) => secret.secretString);

const META_PIXEL_ID = config.require('meta_pixel_id');

const META_ACCESS_TOKEN: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: config.require('meta_access_token') })
  .apply((secret) => secret.secretString);

const POSTHOG_HOST = config.require('posthog_host');
const POSTHOG_API_KEY: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: config.require('posthog_api_key') })
  .apply((secret) => secret.secretString);

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

const { notificationIngressQueueName, notificationIngressQueueArn } =
  getMacroNotify();

const { searchEventQueueName, searchEventQueueArn } = getSearchEventQueue();

const { linkManagerQueueName, linkManagerQueueArn } = getLinkManagerQueue();

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
  queueArns: [
    notificationIngressQueueArn,
    searchEventQueueArn,
    linkManagerQueueArn,
  ],
  containerEnvVars: [
    { name: 'ENVIRONMENT', value: stack },
    {
      name: 'RUST_LOG',
      value: `warn,authentication_service=${stack === 'prod' ? 'info' : 'trace'},tower_http=${stack === 'prod' ? 'info' : 'debug'},macro_auth=${stack === 'prod' ? 'info' : 'debug'},macro_middleware=${stack === 'prod' ? 'info' : 'debug'},github=${stack === 'prod' ? 'info' : 'debug'},fusionauth=debug,warn`,
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
      name: 'FUSIONAUTH_TENANT_ID',
      value: FUSIONAUTH_TENANT_ID,
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
      name: ServiceUrl.DOCUMENT_STORAGE_SERVICE_URL,
      value: getServiceUrl(ServiceUrl.DOCUMENT_STORAGE_SERVICE_URL),
    },
    {
      name: ServiceUrl.NOTIFICATION_SERVICE_URL,
      value: getServiceUrl(ServiceUrl.NOTIFICATION_SERVICE_URL),
    },
    {
      name: 'NOTIFICATION_QUEUE',
      value: pulumi.interpolate`${notificationIngressQueueName}`,
    },
    {
      name: 'SEARCH_EVENT_QUEUE',
      value: pulumi.interpolate`${searchEventQueueName}`,
    },
    {
      name: 'LINK_MANAGER_QUEUE',
      value: pulumi.interpolate`${linkManagerQueueName}`,
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
      name: 'MACRO_API_TOKEN_EXPIRY_SECONDS',
      value: MACRO_API_TOKEN_EXPIRY_SECONDS,
    },
    {
      name: 'STRIPE_WEBHOOK_SECRET_KEY',
      value: pulumi.interpolate`${stripeWebhookSecretKeyArn}`,
    },
    // Stripe price ids
    {
      name: 'STRIPE_PRICE_ID_HAIKU',
      value: pulumi.interpolate`${STRIPE_PRICE_ID_HAIKU}`,
    },
    {
      name: 'STRIPE_PRICE_ID_SONNET',
      value: pulumi.interpolate`${STRIPE_PRICE_ID_SONNET}`,
    },
    {
      name: 'STRIPE_PRICE_ID_OPUS',
      value: pulumi.interpolate`${STRIPE_PRICE_ID_OPUS}`,
    },
    // Github
    {
      name: 'GITHUB_CLIENT_ID',
      value: pulumi.interpolate`${GITHUB_CLIENT_ID}`,
    },
    {
      name: 'GITHUB_CLIENT_SECRET',
      value: pulumi.interpolate`${GITHUB_CLIENT_SECRET}`,
    },
    {
      name: 'GITHUB_IDP_ID',
      value: pulumi.interpolate`${GITHUB_IDP_ID}`,
    },
    // OpenTelemetry / Datadog tracing configuration
    {
      name: 'DD_SERVICE',
      value: 'authentication-service',
    },
    {
      name: 'DD_ENV',
      value: stack,
    },
    // Analytics
    {
      name: 'GA_MEASUREMENT_ID',
      value: GA_ANALYTICS_MEASUREMENT_ID,
    },
    {
      name: 'GA_API_SECRET',
      value: pulumi.interpolate`${GA_API_SECRET}`,
    },
    {
      name: 'META_ACCESS_TOKEN',
      value: pulumi.interpolate`${META_ACCESS_TOKEN}`,
    },
    {
      name: 'META_PIXEL_ID',
      value: META_PIXEL_ID,
    },
    {
      name: 'POSTHOG_HOST',
      value: POSTHOG_HOST,
    },
    {
      name: 'POSTHOG_API_KEY',
      value: pulumi.interpolate`${POSTHOG_API_KEY}`,
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
