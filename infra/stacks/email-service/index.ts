import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import * as tls from '@pulumi/tls';
import { Queue, Redis } from '@resources';
import {
  config,
  getMacroApiToken,
  getMacroNotify,
  getSearchEventQueue,
  stack,
} from '@shared';
import { EmailRefreshHandler } from '@stacks/email-service/refresh_lambda';
import { cloudfrontPrivateKeySecret } from '@stacks/email-service/s3-cloudfront-distribution';
import { EmailScheduledHandler } from '@stacks/email-service/scheduled_lambda';
import { get_coparse_api_vpc } from '@vpc';
import { EmailService } from './service';

const tags = {
  environment: stack,
  tech_lead: 'evan',
  project: 'email-service',
};

export const coparse_api_vpc = get_coparse_api_vpc();

const JWT_SECRET_KEY = config.require(`jwt_secret_key`);
const AUDIENCE = config.require(`fusionauth_client_id`);
const ISSUER = config.require(`fusionauth_issuer`);
const NOTIFICATIONS_ENABLED = config.require(`notifications_enabled`);
const REDIS_RATE_LIMIT_REQS = config.require(`redis_rate_limit_reqs`);
const REDIS_RATE_LIMIT_WINDOW_SECS = config.require(
  `redis_rate_limit_window_secs`
);
const PRESIGNED_URL_TTL_SECS = config.require(`presigned_url_ttl_secs`);
const BACKFILL_QUEUE_WORKERS = config.require(`backfill_queue_workers`);
const BACKFILL_QUEUE_MAX_MESSAGES = config.require(
  `backfill_queue_max_messages`
);
const WEBHOOK_QUEUE_WORKERS = config.require(`webhook_queue_workers`);
const WEBHOOK_QUEUE_MAX_MESSAGES = config.require(`webhook_queue_max_messages`);
const SFS_UPLOADER_WORKERS = config.require(`sfs_uploader_workers`);
const GMAIL_GCP_QUEUE = config.require(`gmail_gcp_queue`);

const jwtSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

const AUTHENTICATION_SERVICE_INTERNAL_API_KEY = config.require(
  `authentication_service_internal_api_key`
);

const CLOUDFRONT_PRIVATE_KEY = config.require(`cf_private_key`);

const authenticationServiceInternalApiKeyArn: pulumi.Output<string> =
  aws.secretsmanager
    .getSecretVersionOutput({
      secretId: AUTHENTICATION_SERVICE_INTERNAL_API_KEY,
    })
    .apply((secret) => secret.arn);

const INTERNAL_AUTH_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`internal_auth_key`),
  })
  .apply((secret) => secret.secretString);

const internalAuthKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: config.require(`internal_auth_key`) })
  .apply((secret) => secret.arn);

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const cloudStorageClusterArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterArn')
  .apply((arn) => arn as string);

const cloudStorageClusterName: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterName')
  .apply((arn) => arn as string);

const { notificationQueueName, notificationQueueArn } = getMacroNotify();

const emailServiceRedis = new Redis('email-service-redis', {
  vpc: coparse_api_vpc,
  tags,
  redisArgs: {
    nodeType: stack === 'prod' ? 'cache.t4g.medium' : 'cache.t3.micro',
    port: 6379,
    engineVersion: '7.1',
  },
});

export const emailServiceRedisEndpoint = emailServiceRedis.endpoint;

const MACRO_DB_URL_SECRET_NAME = config.require(`macro_db_secret_key`);
const MACRO_DB_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: MACRO_DB_URL_SECRET_NAME,
  })
  .apply((secret) => secret.secretString);

const macroDbUrlArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: MACRO_DB_URL_SECRET_NAME })
  .apply((secret) => secret.arn);

const webhook_queue = new Queue('email-service-gmail-webhook', {
  tags,
  maxReceiveCount: 20,
  visibilityTimeoutSeconds: 60,
});

export const webhookQueueArn = pulumi.interpolate`${webhook_queue.queue.arn}`;
export const webhookQueueName = pulumi.interpolate`${webhook_queue.queue.name}`;

const refresh_queue = new Queue('email-service-refresh', {
  tags,
});

export const refreshQueueArn = pulumi.interpolate`${refresh_queue.queue.arn}`;
export const refreshQueueName = pulumi.interpolate`${refresh_queue.queue.name}`;

const scheduled_queue = new Queue('email-service-scheduled', {
  tags,
  fifoQueue: true,
});

export const scheduledQueueArn = pulumi.interpolate`${scheduled_queue.queue.arn}`;
export const scheduledQueueName = pulumi.interpolate`${scheduled_queue.queue.name}`;

const backfill_queue = new Queue('email-service-backfill', {
  tags,
  maxReceiveCount: 20,
  visibilityTimeoutSeconds: 60,
});

export const backfillQueueArn = pulumi.interpolate`${backfill_queue.queue.arn}`;
export const backfillQueueName = pulumi.interpolate`${backfill_queue.queue.name}`;

const sfs_uploader_queue = new Queue('email-service-sfs-mapper', {
  tags,
  maxReceiveCount: 5,
  visibilityTimeoutSeconds: 60,
});

export const sfsUploaderQueueArn = pulumi.interpolate`${sfs_uploader_queue.queue.arn}`;
export const sfsUploaderQueueName = pulumi.interpolate`${sfs_uploader_queue.queue.name}`;

const { searchEventQueueName, searchEventQueueArn } = getSearchEventQueue();

const insightServiceStack = new pulumi.StackReference('insight-service-stack', {
  name: `macro-inc/insight-service/${stack}`,
});

const insightContextQueueArn: pulumi.Output<string> = insightServiceStack
  .getOutput('contextQueueArn')
  .apply((arn) => arn as string);

const insightContextQueueName: pulumi.Output<string> = insightServiceStack
  .getOutput('contextQueueName')
  .apply((name) => name as string);

const MACRO_API_TOKENS = getMacroApiToken();

const cfKeyPair = new tls.PrivateKey(`cf-dist-email-key-pair-${stack}`, {
  algorithm: 'RSA',
  rsaBits: 2048,
});

const cloudfrontSecretKey = cloudfrontPrivateKeySecret({
  secretName: CLOUDFRONT_PRIVATE_KEY,
  keyPair: cfKeyPair,
});

const secretKeyArns = [
  jwtSecretKeyArn,
  authenticationServiceInternalApiKeyArn,
  internalAuthKeyArn,
  macroDbUrlArn,
  MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
  cloudfrontSecretKey.arn,
];

const queueArns = [
  notificationQueueArn,
  webhookQueueArn,
  refreshQueueArn,
  scheduledQueueArn,
  searchEventQueueArn,
  insightContextQueueArn,
  backfillQueueArn,
  sfsUploaderQueueArn,
];

const emailService = new EmailService('email-service', {
  vpc: coparse_api_vpc,
  tags,
  ecsClusterArn: cloudStorageClusterArn,
  clusterName: cloudStorageClusterName,
  secretKeyArns,
  serviceContainerPort: 8080,
  isPrivate: false,
  healthCheckPath: '/health',
  platform: { family: 'linux', architecture: 'amd64' },
  queueArns,
  cfKeyPair: cfKeyPair,
  containerEnvVars: [
    {
      name: 'RUST_LOG',
      value: `email_service=${stack === 'prod' ? 'debug' : 'debug'},email_db_client=${stack === 'prod' ? 'info' : 'debug'},gmail_client=${stack === 'prod' ? 'info' : 'debug'},tower_http=info,insight_service_client=${stack === 'prod' ? 'info' : 'debug'}`,
    },
    {
      name: 'ENVIRONMENT',
      value: stack,
    },
    {
      name: 'MACRO_DB_URL',
      value: pulumi.interpolate`${MACRO_DB_URL}`,
    },
    {
      name: 'REDIS_URI',
      value: pulumi.interpolate`redis://${emailServiceRedis.endpoint}`,
    },
    {
      name: 'EMAIL_REFRESH_QUEUE',
      value: refreshQueueName,
    },
    {
      name: 'EMAIL_SCHEDULED_QUEUE',
      value: scheduledQueueName,
    },
    {
      name: 'GMAIL_WEBHOOK_QUEUE',
      value: webhookQueueName,
    },
    {
      name: 'BACKFILL_QUEUE',
      value: backfillQueueName,
    },
    {
      name: 'SFS_UPLOADER_QUEUE',
      value: sfsUploaderQueueName,
    },
    {
      name: 'GMAIL_GCP_QUEUE',
      value: pulumi.interpolate`${GMAIL_GCP_QUEUE}`,
    },
    {
      name: 'NOTIFICATION_QUEUE',
      value: pulumi.interpolate`${notificationQueueName}`,
    },
    {
      name: 'INSIGHT_CONTEXT_QUEUE',
      value: pulumi.interpolate`${insightContextQueueName}`,
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
      value: pulumi.interpolate`${INTERNAL_AUTH_KEY}`,
    },
    {
      name: 'AUTHENTICATION_SERVICE_URL',
      value: pulumi.interpolate`https://auth-service${stack === 'prod' ? '' : `-${stack}`}.macro.com`,
    },
    {
      name: 'AUTHENTICATION_SERVICE_SECRET_KEY',
      value: pulumi.interpolate`${AUTHENTICATION_SERVICE_INTERNAL_API_KEY}`,
    },
    {
      name: 'STATIC_FILE_SERVICE_URL',
      value: `https://static-file-service${stack === 'prod' ? '' : `-${stack}`}.macro.com`,
    },
    {
      name: 'DOCUMENT_STORAGE_SERVICE_URL',
      value: `https://cloud-storage${stack === 'prod' ? '' : `-${stack}`}.macro.com`,
    },
    {
      name: 'CONNECTION_GATEWAY_URL',
      value: `https://connection-gateway${stack === 'prod' ? '' : `-${stack}`}.macro.com`,
    },
    {
      name: 'NOTIFICATIONS_ENABLED',
      value: pulumi.interpolate`${NOTIFICATIONS_ENABLED}`,
    },
    {
      name: 'SEARCH_EVENT_QUEUE',
      value: pulumi.interpolate`${searchEventQueueName}`,
    },
    {
      name: 'REDIS_RATE_LIMIT_REQS',
      value: pulumi.interpolate`${REDIS_RATE_LIMIT_REQS}`,
    },
    {
      name: 'REDIS_RATE_LIMIT_WINDOW_SECS',
      value: pulumi.interpolate`${REDIS_RATE_LIMIT_WINDOW_SECS}`,
    },
    {
      name: 'BACKFILL_QUEUE_WORKERS',
      value: pulumi.interpolate`${BACKFILL_QUEUE_WORKERS}`,
    },
    {
      name: 'BACKFILL_QUEUE_MAX_MESSAGES',
      value: pulumi.interpolate`${BACKFILL_QUEUE_MAX_MESSAGES}`,
    },
    {
      name: 'WEBHOOK_QUEUE_WORKERS',
      value: pulumi.interpolate`${WEBHOOK_QUEUE_WORKERS}`,
    },
    {
      name: 'WEBHOOK_QUEUE_MAX_MESSAGES',
      value: pulumi.interpolate`${WEBHOOK_QUEUE_MAX_MESSAGES}`,
    },
    {
      name: 'SFS_UPLOADER_WORKERS',
      value: pulumi.interpolate`${SFS_UPLOADER_WORKERS}`,
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
      name: 'PRESIGNED_URL_TTL_SECS',
      value: pulumi.interpolate`${PRESIGNED_URL_TTL_SECS}`,
    },
    {
      name: 'CLOUDFRONT_SIGNER_PRIVATE_KEY',
      value: pulumi.interpolate`${CLOUDFRONT_PRIVATE_KEY}`,
    },
  ],
});

export const emailServiceUrl = pulumi.interpolate`${emailService.domain}`;

const emailRefreshHandler = new EmailRefreshHandler('email-refresh-handler', {
  queueArns: [refreshQueueArn],
  vpc: coparse_api_vpc,
  envVars: {
    DATABASE_URL: pulumi.interpolate`${MACRO_DB_URL}`,
    EMAIL_REFRESH_QUEUE: pulumi.interpolate`${refreshQueueName}`,
    ENVIRONMENT: stack,
    RUST_LOG: 'email_refresh_handler=info',
  },
  tags,
});

const emailScheduledHandler = new EmailScheduledHandler(
  'email-scheduled-handler',
  {
    queueArns: [scheduledQueueArn],
    vpc: coparse_api_vpc,
    envVars: {
      DATABASE_URL: pulumi.interpolate`${MACRO_DB_URL}`,
      EMAIL_SCHEDULED_QUEUE: pulumi.interpolate`${scheduledQueueName}`,
      ENVIRONMENT: stack,
      RUST_LOG: 'email_scheduled_handler=info',
    },
    tags,
  }
);

export const emailRefreshHandlerRoleArn = emailRefreshHandler.role.arn;
export const emailRefreshHandlerLambdaName = emailRefreshHandler.lambda.name;
export const emailRefreshHandlerLambdaArn = emailRefreshHandler.lambda.arn;

export const emailScheduledHandlerRoleArn = emailScheduledHandler.role.arn;
export const emailScheduledHandlerLambdaName =
  emailScheduledHandler.lambda.name;
export const emailScheduledHandlerLambdaArn = emailScheduledHandler.lambda.arn;
