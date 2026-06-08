import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import {
  config,
  getBackfillQueue,
  getLinkManagerQueue,
  getMacroApiToken,
  getMacroNotify,
  getSearchEventQueue,
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

const dopplerSecretSyncArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('doppler_secret_sync_key'),
  })
  .apply((secret) => secret.arn);

const DATABASE_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_secret_key`),
  })
  .apply((secret) => secret.secretString);

const JWT_SECRET_KEY = config.require(`jwt_secret_key`);
const FUSIONAUTH_API_KEY_SECRET_KEY = config.require(
  `fusionauth_api_key_secret_key`
);
const AUTHENTICATION_SERVICE_INTERNAL_API_KEY = config.require(
  `authentication_service_internal_api_key`
);

const FUSIONAUTH_CLIENT_SECRET_KEY = config.require(
  `fusionauth_client_secret_key`
);
const STRIPE_SECRET_KEY = config.require(`stripe_secret_key`);

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

const fusionauthClientSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: FUSIONAUTH_CLIENT_SECRET_KEY })
  .apply((secret) => secret.arn);

const stripeSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: STRIPE_SECRET_KEY })
  .apply((secret) => secret.arn);

const GOOGLE_CLIENT_SECRET_KEY = config.require(`google_client_secret_key`);
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

const { notificationIngressQueueArn } = getMacroNotify();

const { searchEventQueueArn } = getSearchEventQueue();

const { linkManagerQueueArn } = getLinkManagerQueue();

const { backfillQueueArn } = getBackfillQueue();

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
    backfillQueueArn,
  ],
  containerEnvVars: [
    { name: 'ENVIRONMENT', value: stack },
    { name: 'DOPPLER_PROJECT', value: 'authentication_service' },
    // OpenTelemetry / Datadog tracing configuration
    {
      name: 'DD_SERVICE',
      value: 'authentication-service',
    },
    {
      name: 'DD_ENV',
      value: stack,
    },
  ],
  containerSecrets: [
    {
      name: 'APP_SECRETS_JSON',
      valueFrom: pulumi.interpolate`${dopplerSecretSyncArn}`,
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
