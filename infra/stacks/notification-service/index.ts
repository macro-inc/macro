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

const UNSUBSCRIBE_HMAC_SECRET_KEY = `url-signing-hmac-${stack}`;
const unsubscribeHmacSecretArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: UNSUBSCRIBE_HMAC_SECRET_KEY })
  .apply((secret) => secret.arn);

const FCM_SECRET_KEY = config.require(`fcm_secret_key`);
const fcmCredentials: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: FCM_SECRET_KEY })
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

const notificationQueue = new Queue('notification', {
  tags,
});

const notificationIngressQueue = new Queue('notification-ingress', {
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

const notificationApnsVoipPlatform = new aws.sns.PlatformApplication(
  'notification-apns-voip-platform',
  {
    name: `notification-apns-voip-platform-${stack}`,
    platform: stack === 'prod' ? 'APNS_VOIP' : 'APNS_VOIP_SANDBOX',
    applePlatformTeamId: APPLE_TEAM_ID,
    applePlatformBundleId: pulumi.interpolate`${APPLE_BUNDLE_ID}.voip`,
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

const notificationQueueArn = notificationQueue.queue.arn;
export const notificationIngressQueueArn = notificationIngressQueue.queue.arn;
export const notificationIngressQueueName = notificationIngressQueue.queue.name;
export const notificationSnsPlatformArns = [
  notificationApnsPlatform.arn,
  notificationApnsVoipPlatform.arn,
  notificationFcmPlatform.arn,
];
export const notificationApnsVoipPlatformArn = notificationApnsVoipPlatform.arn;

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
    unsubscribeHmacSecretArn,
  ],
  queueArns: [
    pushNotificationEventHandlerQueueArn,
    notificationQueueArn,
    notificationIngressQueueArn,
  ],
  snsPlatformArns: notificationSnsPlatformArns,
  serviceContainerPort: 8080,
  isPrivate: false,
  healthCheckPath: '/health',
  platform: { family: 'linux', architecture: 'amd64' },
  containerEnvVars: [
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
