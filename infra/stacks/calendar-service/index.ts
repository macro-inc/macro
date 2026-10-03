import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Queue, Redis } from '../../packages/resources';
import {
  BASE_DOMAIN,
  config,
  getLinkManagerQueue,
  getMacroApiToken,
  stack,
} from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { CalendarService } from './service';

const tags = {
  environment: stack,
  tech_lead: 'gab',
  project: 'calendar-service',
};

export const coparse_api_vpc = get_coparse_api_vpc();

const AUTHENTICATION_SERVICE_INTERNAL_API_KEY = config.require(
  `authentication_service_internal_api_key`
);
const JWT_SECRET_KEY = config.require(`jwt_secret_key`);
const INTERNAL_AUTH_KEY = config.require(`internal_auth_key`);
const MACRO_DB_URL_SECRET_NAME = config.require(`macro_db_secret_key`);

const authenticationServiceInternalApiKeyArn: pulumi.Output<string> =
  aws.secretsmanager
    .getSecretVersionOutput({
      secretId: AUTHENTICATION_SERVICE_INTERNAL_API_KEY,
    })
    .apply((secret) => secret.arn);

const jwtSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

const internalAuthKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: INTERNAL_AUTH_KEY })
  .apply((secret) => secret.arn);

const macroDbUrlArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: MACRO_DB_URL_SECRET_NAME })
  .apply((secret) => secret.arn);

const MACRO_API_TOKENS = getMacroApiToken();

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const cloudStorageClusterArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterArn')
  .apply((arn) => arn as string);

const cloudStorageClusterName: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterName')
  .apply((arn) => arn as string);

const calendarServiceRedis = new Redis('calendar-service-redis', {
  vpc: coparse_api_vpc,
  tags,
  redisArgs: {
    // Dormant service: a small node in both stacks. Resize at cutover.
    nodeType: 'cache.t3.micro',
    port: 6379,
    engineVersion: '7.1',
  },
});

// Exported so the operator can point the calendar-service Doppler `REDIS_URI`
// at this endpoint before the service is enabled. Config is loaded from
// `APP_SECRETS_JSON` (Doppler), so the endpoint cannot be injected as a plain
// container env var — it flows through Doppler, exactly like email-service.
export const calendarServiceRedisEndpoint = calendarServiceRedis.endpoint;

// Calendar's own backfill queue. The `Queue` construct appends
// `-queue-${stack}`, producing `calendar-service-backfill-queue-{dev,prod}`,
// which is exactly the name the Rust side expects
// (`macro_queues::CalendarServiceBackfillQueue`).
const backfillQueue = new Queue('calendar-service-backfill', {
  tags,
  maxReceiveCount: 20,
  visibilityTimeoutSeconds: 60,
  alarm: {
    approximateAgeOfOldestMessageThreshold: 600, // 10 minutes
  },
});

export const calendarBackfillQueueArn = pulumi.interpolate`${backfillQueue.queue.arn}`;
export const calendarBackfillQueueName = pulumi.interpolate`${backfillQueue.queue.name}`;

// Reauth-required notifications are enqueued onto email-service's shared
// link-manager queue, whose consumer owns the reconnect-your-inbox
// notification. calendar-service is granted send-only access to it.
const { linkManagerQueueArn } = getLinkManagerQueue();

const secretKeyArns = [
  authenticationServiceInternalApiKeyArn,
  jwtSecretKeyArn,
  internalAuthKeyArn,
  macroDbUrlArn,
  MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
];

const containerEnvVars = [
  {
    name: 'ENVIRONMENT',
    value: stack,
  },
  { name: 'DOPPLER_PROJECT', value: 'calendar_service' },
  {
    name: 'DD_SERVICE',
    value: 'calendar-service',
  },
  {
    name: 'DD_ENV',
    value: stack,
  },
];

const calendarService = new CalendarService('calendar-service', {
  calendarBackfillQueueArn,
  linkManagerQueueArn,
  vpc: coparse_api_vpc,
  tags,
  containerEnvVars,
  platform: { family: 'linux', architecture: 'amd64' },
  serviceContainerPort: 8080,
  healthCheckPath: '/health',
  ecsClusterArn: cloudStorageClusterArn,
  cloudStorageClusterName,
  secretKeyArns,
});

export const calendarServiceUrl = calendarService.domain;

export const calendarServiceGatewayUrl = `https://${
  stack === 'prod' ? '' : `${stack}-`
}gateway.${BASE_DOMAIN}/calendar`;
