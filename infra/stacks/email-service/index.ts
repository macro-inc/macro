import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import * as tls from '@pulumi/tls';
import {
  createFrecencyTablePolicy,
  Queue,
  Redis,
} from '../../packages/resources';
import {
  config,
  getMacroApiToken,
  getMacroNotify,
  getSearchEventQueue,
  stack,
} from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { EmailAttachmentsBucket } from './attachments-bucket';
import { EmailPubSubWorkers } from './pubsub_workers';
import { EmailRefreshHandler } from './refresh_lambda';
import {
  cloudfrontPrivateKeySecret,
  getCloudfrontDistribution,
} from './s3-cloudfront-distribution';
import { EmailScheduledHandler } from './scheduled_lambda';
import { EmailService } from './service';

const tags = {
  environment: stack,
  tech_lead: 'evan',
  project: 'email-service',
};

export const coparse_api_vpc = get_coparse_api_vpc();

const JWT_SECRET_KEY = config.require(`jwt_secret_key`);
const fusionauthClientIdSecretKey = config.require(`fusionauth_client_id`);

const AUDIENCE = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: fusionauthClientIdSecretKey,
  })
  .apply((secret) => secret.secretString);
const ISSUER = config.require(`fusionauth_issuer`);
const NOTIFICATIONS_ENABLED = config.require(`notifications_enabled`);
const REDIS_RATE_LIMIT_REQS = config.require(`redis_rate_limit_reqs`);
const REDIS_RATE_LIMIT_REQS_BACKFILL = config.require(
  `redis_rate_limit_reqs_backfill`
);
const REDIS_RATE_LIMIT_WINDOW_SECS = config.require(
  `redis_rate_limit_window_secs`
);
const PRESIGNED_URL_TTL_SECS = config.require(`presigned_url_ttl_secs`);
const BACKFILL_QUEUE_WORKERS = config.require(`backfill_queue_workers`);
const BACKFILL_QUEUE_MAX_MESSAGES = config.require(
  `backfill_queue_max_messages`
);
const INBOX_SYNC_QUEUE_WORKERS = config.require(`inbox_sync_queue_workers`);
const INBOX_SYNC_QUEUE_MAX_MESSAGES = config.require(
  `inbox_sync_queue_max_messages`
);
const INBOX_SYNC_RETRY_QUEUE_WORKERS = config.require(
  `inbox_sync_retry_queue_workers`
);
const INBOX_SYNC_RETRY_QUEUE_MAX_MESSAGES = config.require(
  `inbox_sync_retry_queue_max_messages`
);
const SFS_UPLOADER_WORKERS = config.require(`sfs_uploader_workers`);
const gmailGcpQueue = config.require(`gmail_gcp_queue`);
const GMAIL_GCP_QUEUE = aws.secretsmanager
  .getSecretVersionOutput({ secretId: gmailGcpQueue })
  .apply((secret) => secret.secretString);

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

const inbox_sync_queue = new Queue('email-service-gmail-webhook', {
  tags,
  maxReceiveCount: 5,
  visibilityTimeoutSeconds: 60,
});

export const inboxSyncQueueArn = pulumi.interpolate`${inbox_sync_queue.queue.arn}`;
export const inboxSyncQueueName = pulumi.interpolate`${inbox_sync_queue.queue.name}`;

const inbox_sync_retry_queue = new Queue('email-service-gmail-webhook-retry', {
  tags,
  maxReceiveCount: 100,
  visibilityTimeoutSeconds: 60,
});

export const inboxSyncRetryQueueArn = pulumi.interpolate`${inbox_sync_retry_queue.queue.arn}`;
export const inboxSyncRetryQueueName = pulumi.interpolate`${inbox_sync_retry_queue.queue.name}`;

const link_manager_queue = new Queue('email-service-refresh', {
  tags,
  // deleting a link from the database can sometimes take a long time
  visibilityTimeoutSeconds: 300,
});

export const linkManagerQueueArn = pulumi.interpolate`${link_manager_queue.queue.arn}`;
export const linkManagerQueueName = pulumi.interpolate`${link_manager_queue.queue.name}`;

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

// Retrieve name of queue used Contacts Service
const contactsServiceStack: pulumi.StackReference = new pulumi.StackReference(
  'contacts-service-stack',
  {
    name: `macro-inc/contacts-service/${stack}`,
  }
);

const contactsQueueName: pulumi.Output<string> = contactsServiceStack
  .getOutput('contactsQueueName')
  .apply((arn) => arn as string);

// Get ARN to allow sending messages to contacts Queue
const contactsQueueArn: pulumi.Output<string> = contactsServiceStack
  .getOutput('contactsQueueArn')
  .apply((arn) => arn as string);

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
  inboxSyncQueueArn,
  inboxSyncRetryQueueArn,
  linkManagerQueueArn,
  scheduledQueueArn,
  searchEventQueueArn,
  backfillQueueArn,
  sfsUploaderQueueArn,
  contactsQueueArn,
];

const emailServiceSecretsPolicy = new aws.iam.Policy(
  'email-service-secrets-policy-2',
  {
    policy: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: ['secretsmanager:GetSecretValue'],
          Resource: [...secretKeyArns],
          Effect: 'Allow',
        },
      ],
    },
    tags: tags,
  }
);

const emailServiceSqsPolicy = new aws.iam.Policy('email-service-sqs-policy-2', {
  policy: pulumi.output({
    Version: '2012-10-17',
    Statement: [
      {
        Action: ['sqs:*'],
        Resource: queueArns,
        Effect: 'Allow',
      },
    ],
  }),
  tags: tags,
});

const emailServiceFrecencyPolicy = createFrecencyTablePolicy(
  'email-service-frecency-policy-2'
);

// Create IAM role for email service
const emailServiceRole = new aws.iam.Role('email-service-role-2', {
  name: `email-service-role-2-${stack}`,
  assumeRolePolicy: {
    Version: '2012-10-17',
    Statement: [
      {
        Action: 'sts:AssumeRole',
        Principal: {
          Service: 'ecs-tasks.amazonaws.com',
        },
        Effect: 'Allow',
        Sid: '',
      },
    ],
  },
  tags: tags,
  managedPolicyArns: [
    emailServiceSecretsPolicy.arn,
    emailServiceSqsPolicy.arn,
    emailServiceFrecencyPolicy.arn,
  ],
});

let emailAttachmentBucket: EmailAttachmentsBucket;
if (stack !== 'local') {
  emailAttachmentBucket = new EmailAttachmentsBucket(
    `email-attachments-bucket-${stack}`,
    {
      emailServiceRoleArn: emailServiceRole.arn,
    }
  );
} else {
  emailAttachmentBucket = new EmailAttachmentsBucket(
    `email-attachments-bucket-${stack}`,
    {}
  );
}

const cloudfrontDistribution = getCloudfrontDistribution({
  bucket: emailAttachmentBucket.bucket,
  keyPair: cfKeyPair,
});

emailAttachmentBucket.attachCloudfrontPolicy({
  cloudfrontDistributionArn: cloudfrontDistribution.distribution.arn,
  emailServiceRoleArn: emailServiceRole.arn,
});

const containerEnvVars = [
  {
    name: 'RUST_LOG',
    value: `email=${stack === 'prod' ? 'debug' : 'debug'},email_service=${stack === 'prod' ? 'debug' : 'debug'},pubsub_workers=${stack === 'prod' ? 'debug' : 'debug'},email_db_client=${stack === 'prod' ? 'info' : 'debug'},gmail_client=${stack === 'prod' ? 'info' : 'debug'},tower_http=info`,
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
    name: 'LINK_MANAGER_QUEUE',
    value: linkManagerQueueName,
  },
  {
    name: 'EMAIL_SCHEDULED_QUEUE',
    value: scheduledQueueName,
  },
  {
    name: 'GMAIL_INBOX_SYNC_QUEUE',
    value: inboxSyncQueueName,
  },
  {
    name: 'GMAIL_INBOX_SYNC_RETRY_QUEUE',
    value: inboxSyncRetryQueueName,
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
    name: 'REDIS_RATE_LIMIT_REQS_BACKFILL',
    value: pulumi.interpolate`${REDIS_RATE_LIMIT_REQS_BACKFILL}`,
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
    name: 'INBOX_SYNC_QUEUE_WORKERS',
    value: pulumi.interpolate`${INBOX_SYNC_QUEUE_WORKERS}`,
  },
  {
    name: 'INBOX_SYNC_QUEUE_MAX_MESSAGES',
    value: pulumi.interpolate`${INBOX_SYNC_QUEUE_MAX_MESSAGES}`,
  },
  {
    name: 'INBOX_SYNC_RETRY_QUEUE_WORKERS',
    value: pulumi.interpolate`${INBOX_SYNC_RETRY_QUEUE_WORKERS}`,
  },
  {
    name: 'INBOX_SYNC_RETRY_QUEUE_MAX_MESSAGES',
    value: pulumi.interpolate`${INBOX_SYNC_RETRY_QUEUE_MAX_MESSAGES}`,
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
  {
    name: 'CONTACTS_QUEUE',
    value: pulumi.interpolate`${contactsQueueName}`,
  },
  {
    name: 'ATTACHMENT_BUCKET',
    value: emailAttachmentBucket.bucket.id,
  },
  {
    name: 'CLOUDFRONT_DISTRIBUTION_URL',
    value: pulumi.interpolate`${cloudfrontDistribution.domain}`,
  },
  {
    name: 'CLOUDFRONT_SIGNER_PUBLIC_KEY_ID',
    value: pulumi.interpolate`${cloudfrontDistribution.publicKey.id}`,
  },
];

const emailService = new EmailService('email-service', {
  vpc: coparse_api_vpc,
  tags,
  ecsClusterArn: cloudStorageClusterArn,
  clusterName: cloudStorageClusterName,
  role: emailServiceRole,
  serviceContainerPort: 8080,
  isPrivate: false,
  healthCheckPath: '/health',
  platform: { family: 'linux', architecture: 'amd64' },
  containerEnvVars,
});

export const emailServiceUrl = pulumi.interpolate`${emailService.domain}`;

new EmailPubSubWorkers('email-pubsub-workers', {
  vpc: coparse_api_vpc,
  tags,
  ecsClusterArn: cloudStorageClusterArn,
  clusterName: cloudStorageClusterName,
  role: emailServiceRole,
  platform: { family: 'linux', architecture: 'amd64' },
  containerEnvVars,
});

const DELETE_UNUSED_AFTER_DAYS = config.require(`delete_unused_after_days`);
const DELETE_INACTIVE_AFTER_DAYS = config.require(`delete_inactive_after_days`);

const emailRefreshHandler = new EmailRefreshHandler('email-refresh-handler', {
  queueArns: [linkManagerQueueArn],
  vpc: coparse_api_vpc,
  envVars: {
    DATABASE_URL: pulumi.interpolate`${MACRO_DB_URL}`,
    LINK_MANAGER_QUEUE: pulumi.interpolate`${linkManagerQueueName}`,
    ENVIRONMENT: stack,
    RUST_LOG: 'email_refresh_handler=info',
    DELETE_UNUSED_AFTER_DAYS: pulumi.interpolate`${DELETE_UNUSED_AFTER_DAYS}`,
    DELETE_INACTIVE_AFTER_DAYS: pulumi.interpolate`${DELETE_INACTIVE_AFTER_DAYS}`,
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
