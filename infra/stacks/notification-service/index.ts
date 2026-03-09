import * as aws from '@pulumi/aws';
import type * as pulumi from '@pulumi/pulumi';
import { Queue } from '../../packages/resources';
import { config, stack } from '../../packages/shared';
import { PushNotificationEventHandler } from './push';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'notifications',
};

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
