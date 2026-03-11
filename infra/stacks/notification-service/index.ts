import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Queue } from '../../packages/resources';
import { config, getMacroApiToken, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { PushNotificationEventHandler } from './push';
import { NotificationService } from './service';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'notifications',
};

const JWT_SECRET_KEY = config.require(`jwt_secret_key`);
const jwtSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

const INTERNAL_API_SECRET_KEY = config.require(`internal_api_key`);
const internalApiKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: INTERNAL_API_SECRET_KEY })
  .apply((secret) => secret.arn);

const fusionauthClientIdSecretKey = config.require(`fusionauth_client_id`);
const AUDIENCE = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: fusionauthClientIdSecretKey,
  })
  .apply((secret) => secret.secretString);

const ISSUER = config.require(`fusionauth_issuer`);

const appleTeamId = config.require(`apple_team_id`);
const APPLE_TEAM_ID = aws.secretsmanager
  .getSecretVersionOutput({ secretId: appleTeamId })
  .apply((secret) => secret.secretString);

const appleBundleId = config.require(`apple_bundle_id`);
const APPLE_BUNDLE_ID = aws.secretsmanager
  .getSecretVersionOutput({ secretId: appleBundleId })
  .apply((secret) => secret.secretString);

const apnsKeyId = config.require(`apns_key_id`);
const APNS_KEY_ID = aws.secretsmanager
  .getSecretVersionOutput({ secretId: apnsKeyId })
  .apply((secret) => secret.secretString);
const APNS_PRIVATE_KEY = config.requireSecret(`apns_private_key`);

const FCM_SECRET_KEY = config.require(`fcm_secret_key`);
const fcmCredentials: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: FCM_SECRET_KEY })
  .apply((secret) => secret.secretString);

const MACRO_CACHE = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_cache_secret_key`),
  })
  .apply((secret) => secret.secretString);

const AUTHENTICATION_SERVICE_INTERNAL_API_KEY = config.require(
  `authentication_service_internal_api_key`
);

const authenticationServiceInternalApiKeyArn: pulumi.Output<string> =
  aws.secretsmanager
    .getSecretVersionOutput({
      secretId: AUTHENTICATION_SERVICE_INTERNAL_API_KEY,
    })
    .apply((secret) => secret.arn);

export const coparse_api_vpc = get_coparse_api_vpc();

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const cloudStorageClusterArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterArn')
  .apply((arn) => arn as string);

const cloudStorageClusterName: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterName')
  .apply((arn) => arn as string);

const DATABASE_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_secret_key`),
  })
  .apply((secret) => secret.secretString);

const notificationQueue = new Queue('notification', {
  tags,
});

const pushNotificationEventHandler = new PushNotificationEventHandler(
  'push-notification-event-handler',
  {
    tags,
  }
);

export const pushNotificationEventHandlerQueueArn =
  pushNotificationEventHandler.pushDeliveryQueue.arn;
export const pushNotificationEventHandlerQueueName =
  pushNotificationEventHandler.pushDeliveryQueue.name;
export const pushNotificationEventHandlerTopicArn =
  pushNotificationEventHandler.pushDeliveryTopic.arn;

const notificationApnsPlatform = new aws.sns.PlatformApplication(
  'notification-apns-platform',
  {
    name: `notification-apns-platform-${stack}`,
    platform: stack === 'prod' ? 'APNS' : 'APNS_SANDBOX', // use sandbox for dev
    applePlatformTeamId: APPLE_TEAM_ID,
    applePlatformBundleId: APPLE_BUNDLE_ID,
    platformPrincipal: APNS_KEY_ID,
    platformCredential: APNS_PRIVATE_KEY,
    eventDeliveryFailureTopicArn: pushNotificationEventHandlerTopicArn,
    eventEndpointDeletedTopicArn: pushNotificationEventHandlerTopicArn,
  }
);

const notificationFcmPlatform = new aws.sns.PlatformApplication(
  'notification-fcm-platform',
  {
    name: `notification-fcm-platform-${stack}`,
    platform: 'GCM',
    platformCredential: fcmCredentials,
    eventDeliveryFailureTopicArn: pushNotificationEventHandlerTopicArn,
    eventEndpointDeletedTopicArn: pushNotificationEventHandlerTopicArn,
    successFeedbackSampleRate: '0',
  }
);

export const notificationQueueArn = notificationQueue.queue.arn;
export const notificationQueueName = notificationQueue.queue.name;
export const notificationSnsPlatformArns = [
  notificationApnsPlatform.arn,
  notificationFcmPlatform.arn,
];

const MACRO_API_TOKENS = getMacroApiToken();

const notificationService = new NotificationService('notification-service', {
  vpc: coparse_api_vpc,
  tags,
  ecsClusterArn: cloudStorageClusterArn,
  cloudStorageClusterName,
  secretKeyArns: [
    jwtSecretKeyArn,
    internalApiKeyArn,
    MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
    authenticationServiceInternalApiKeyArn,
  ],
  queueArns: [pushNotificationEventHandlerQueueArn, notificationQueueArn],
  snsPlatformArns: notificationSnsPlatformArns,
  serviceContainerPort: 8080,
  isPrivate: false,
  healthCheckPath: '/health',
  platform: { family: 'linux', architecture: 'amd64' },
  containerEnvVars: [
    {
      name: 'RUST_LOG',
      value: `error,notification_service=${stack === 'prod' ? 'debug' : 'trace'},notification_db_client=${stack === 'prod' ? 'info' : 'debug'},tower_http=info`,
    },
    {
      name: 'ENVIRONMENT',
      value: stack,
    },
    {
      name: 'DATABASE_URL',
      value: pulumi.interpolate`${DATABASE_URL}`,
    },
    {
      name: 'JWT_SECRET_KEY',
      value: pulumi.interpolate`${JWT_SECRET_KEY}`,
    },
    {
      name: 'AUDIENCE',
      value: pulumi.interpolate`${AUDIENCE}`,
    },
    {
      name: 'ISSUER',
      value: pulumi.interpolate`${ISSUER}`,
    },
    {
      name: 'INTERNAL_API_SECRET_KEY',
      value: pulumi.interpolate`${INTERNAL_API_SECRET_KEY}`,
    },
    {
      name: 'NOTIFICATION_QUEUE',
      value: pulumi.interpolate`${notificationQueueName}`,
    },
    {
      name: 'PUSH_NOTIFICATION_EVENT_HANDLER_QUEUE',
      value: pulumi.interpolate`${pushNotificationEventHandlerQueueName}`,
    },
    {
      name: 'DOCUMENT_STORAGE_SERVICE_URL',
      value: `https://cloud-storage${
        stack === 'prod' ? '' : `-${stack}`
      }.macro.com`,
    },
    {
      name: 'DOCUMENT_COGNITION_SERVICE_URL',
      value: `https://document-cognition${
        stack === 'prod' ? '' : `-${stack}`
      }.macro.com`,
    },
    {
      name: 'CONNECTION_GATEWAY_URL',
      value: `https://connection-gateway${
        stack === 'prod' ? '' : `-${stack}`
      }.macro.com`,
    },
    {
      name: 'ORGANIZATION_SERVICE_URL',
      value: `https://organization-service${
        stack === 'prod' ? '' : `-${stack}`
      }.macro.com`,
    },
    {
      name: 'SNS_APNS_PLATFORM_ARN',
      value: pulumi.interpolate`${notificationApnsPlatform.arn}`,
    },
    {
      name: 'SNS_FCM_PLATFORM_ARN',
      value: pulumi.interpolate`${notificationFcmPlatform.arn}`,
    },
    {
      name: 'SENDER_BASE_ADDRESS',
      value: 'notification.macro.com',
    },
    {
      name: 'APPLE_BUNDLE_ID',
      value: APPLE_BUNDLE_ID,
    },
    {
      name: 'REDIS_URI',
      value: pulumi.interpolate`redis://${MACRO_CACHE}`,
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
      name: 'AUTHENTICATION_SERVICE_URL',
      value: pulumi.interpolate`https://auth-service${stack === 'prod' ? '' : `-${stack}`}.macro.com`,
    },
    {
      name: 'AUTHENTICATION_SERVICE_SECRET_KEY',
      value: pulumi.interpolate`${AUTHENTICATION_SERVICE_INTERNAL_API_KEY}`,
    },
    // OpenTelemetry / Datadog tracing configuration
    {
      name: 'DD_SERVICE',
      value: 'notification-service',
    },
    {
      name: 'DD_ENV',
      value: stack,
    },
  ],
});

export const notificationServiceUrl = pulumi.interpolate`${notificationService.domain}`;
