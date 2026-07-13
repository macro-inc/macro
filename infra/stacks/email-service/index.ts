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
  DopplerEcsEnvironment,
  getKafkaClusterPolicy,
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

const APOLLO_API_KEY_SECRET_NAME = config.require(`apollo_api_key_secret_name`);
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

const sfsDeleteLambdaStack = new pulumi.StackReference(
  'email-sfs-delete-handler-stack',
  {
    name: `macro-inc/email-sfs-delete-handler/${stack}`,
  }
);

const sfsDeleteQueueArn: pulumi.Output<string> = sfsDeleteLambdaStack
  .getOutput('sfsDeleteQueueArn')
  .apply((arn) => arn as string);

const sfsDeleteQueueName: pulumi.Output<string> = sfsDeleteLambdaStack
  .getOutput('sfsDeleteQueueName')
  .apply((name) => name as string);

const { notificationIngressQueueArn } = getMacroNotify();

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

const apolloApiKeySecretArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: APOLLO_API_KEY_SECRET_NAME })
  .apply((secret) => secret.arn);

const inbox_sync_queue = new Queue('email-service-gmail-webhook', {
  tags,
  maxReceiveCount: 3,
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

const gmail_ops_queue = new Queue('email-service-gmail-ops', {
  tags,
  maxReceiveCount: 3,
  visibilityTimeoutSeconds: 60,
});

export const gmailOpsQueueArn = pulumi.interpolate`${gmail_ops_queue.queue.arn}`;
export const gmailOpsQueueName = pulumi.interpolate`${gmail_ops_queue.queue.name}`;

const gmail_ops_retry_queue = new Queue('email-service-gmail-ops-retry', {
  tags,
  maxReceiveCount: 100,
  visibilityTimeoutSeconds: 60,
});

export const gmailOpsRetryQueueArn = pulumi.interpolate`${gmail_ops_retry_queue.queue.arn}`;
export const gmailOpsRetryQueueName = pulumi.interpolate`${gmail_ops_retry_queue.queue.name}`;

const link_manager_queue = new Queue('email-service-refresh', {
  tags,
  // deleting a link from the database can sometimes take a long time
  visibilityTimeoutSeconds: 300,
});

export const linkManagerQueueArn = pulumi.interpolate`${link_manager_queue.queue.arn}`;
export const linkManagerQueueName = pulumi.interpolate`${link_manager_queue.queue.name}`;

const scheduled_queue = new Queue('email-service-scheduled', {
  tags,
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

export { sfsDeleteQueueArn, sfsDeleteQueueName };

const { searchEventQueueArn } = getSearchEventQueue();

// Retrieve name of queue used Contacts Service
const contactsServiceStack: pulumi.StackReference = new pulumi.StackReference(
  'contacts-service-stack',
  {
    name: `macro-inc/contacts-service/${stack}`,
  }
);

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
  apolloApiKeySecretArn,
];

const queueArns = [
  notificationIngressQueueArn,
  inboxSyncQueueArn,
  inboxSyncRetryQueueArn,
  gmailOpsQueueArn,
  gmailOpsRetryQueueArn,
  linkManagerQueueArn,
  scheduledQueueArn,
  searchEventQueueArn,
  backfillQueueArn,
  sfsUploaderQueueArn,
  sfsDeleteQueueArn,
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
    getKafkaClusterPolicy(),
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
    name: 'ENVIRONMENT',
    value: stack,
  },
  // OpenTelemetry / Datadog tracing configuration
  {
    name: 'DD_SERVICE',
    value: 'email-service',
  },
  {
    name: 'DD_ENV',
    value: stack,
  },
];

const dopplerEcsEnvironment = new DopplerEcsEnvironment(pulumi.getProject(), {
  tags,
});

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
  dopplerEcsEnvironment,
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
  dopplerEcsEnvironment,
});

const DELETE_UNUSED_AFTER_DAYS = config.require(`delete_unused_after_days`);
const DELETE_INACTIVE_AFTER_DAYS = config.require(`delete_inactive_after_days`);
const INBOX_HEALTH_POLL_INTERVAL_HOURS = config.require(
  `inbox_health_poll_interval_hours`
);

const emailRefreshHandler = new EmailRefreshHandler('email-refresh-handler', {
  queueArns: [linkManagerQueueArn],
  vpc: coparse_api_vpc,
  envVars: {
    DATABASE_URL: pulumi.interpolate`${MACRO_DB_URL}`,
    ENVIRONMENT: stack,
    RUST_LOG: 'email_refresh_handler=info',
    DELETE_UNUSED_AFTER_DAYS: pulumi.interpolate`${DELETE_UNUSED_AFTER_DAYS}`,
    DELETE_INACTIVE_AFTER_DAYS: pulumi.interpolate`${DELETE_INACTIVE_AFTER_DAYS}`,
    INBOX_HEALTH_POLL_INTERVAL_HOURS: pulumi.interpolate`${INBOX_HEALTH_POLL_INTERVAL_HOURS}`,
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
