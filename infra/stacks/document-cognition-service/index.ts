import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import {
  config,
  getAiToolsInfra,
  getMacroApiToken,
  getMacroNotify,
  getSearchEventQueue,
  stack,
} from '../../packages/shared';
import { Queue } from '../../packages/resources';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { DocumentCognitionService } from './document-cognition-service';
import { AiProjectionsRefreshTrigger } from './ai-projections-refresh-trigger';

const tags = {
  environment: stack,
  env: stack,
  tech_lead: 'ehayes',
  project: 'document-cognition-service',
  service: 'document-cognition-service',
};

// NOTE: NEVER EVER EVER EXPORT THIS. ITS A SECRET VALUE
const PROXY_DATABASE_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_proxy_secret_key`),
  })
  .apply((secret) => secret.secretString);

const JWT_SECRET_KEY = config.require(`jwt_secret_key`);
const jwtSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

const AUTHENTICATION_SERVICE_INTERNAL_API_KEY_SECRET_NAME = config.require(
  'authentication_service_internal_api_key'
);

const authenticationServiceInternalApiKeyArn: pulumi.Output<string> =
  aws.secretsmanager
    .getSecretVersionOutput({
      secretId: AUTHENTICATION_SERVICE_INTERNAL_API_KEY_SECRET_NAME,
    })
    .apply((secret) => secret.arn);

export const coparse_api_vpc = get_coparse_api_vpc();

// ── AI tools infra ───────────────────────────────────────────────────────────

const aiTools = getAiToolsInfra();

// ── Stack references ─────────────────────────────────────────────────────────

const connectionGatewayStack = new pulumi.StackReference(
  'connection-gateway-stack',
  {
    name: `macro-inc/connection-gateway/${stack}`,
  }
);

const connectionGatewayTablePolicyArn: pulumi.Output<string> =
  connectionGatewayStack
    .getOutput('connectionGatewayTablePolicyArn')
    .apply((arn) => arn as string);

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const cloudStorageServiceStack = new pulumi.StackReference(
  'cloud-storage-service',
  {
    name: `macro-inc/cloud-storage-service/${stack}`,
  }
);

export const deleteChatQueueArn: pulumi.Output<string> =
  cloudStorageServiceStack
    .getOutput('deleteChatQueueArn')
    .apply((arn) => arn as string);

export const deleteChatQueueName: pulumi.Output<string> =
  cloudStorageServiceStack
    .getOutput('deleteChatQueueName')
    .apply((name) => name as string);

const documentTextExtractorStack = new pulumi.StackReference(
  'document-text-extractor',
  {
    name: `macro-inc/document-text-extractor/${stack}`,
  }
);

const documentTextExtractorQueueArn: pulumi.Output<string> =
  documentTextExtractorStack
    .getOutput('documentTextExtractorLambdaQueueArn')
    .apply((arn) => arn as string);

const cloudStorageClusterArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterArn')
  .apply((arn) => arn as string);

const cloudStorageClusterName: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterName')
  .apply((arn) => arn as string);

const { notificationIngressQueueArn } = getMacroNotify();

const { searchEventQueueArn } = getSearchEventQueue();

// ── AI projection queue ──────────────────────────────────────────────────────
// This service both produces (on upsert) and consumes (via the inbound worker)
// ai projection materialization messages, so the queue is owned here. The Queue
// component provisions the queue, its DLQ, and the associated alarms.
const aiProjectionQueue = new Queue('ai-projection', {
  tags,
  maxReceiveCount: 2,
  // Give each message up to 2 minutes to process before it's re-queued.
  visibilityTimeoutSeconds: 120,
});

// Background refresh: scheduled lambda that sweeps user_ai_projection per
// cadence, deleting inactive instances and enqueuing refreshes for stale ones
// onto the ai projection queue owned above.
const aiProjectionsRefreshTrigger = new AiProjectionsRefreshTrigger(
  `ai-projections-refresh-trigger-${stack}`,
  {
    envVars: {
      AI_PROJECTION_QUEUE: pulumi.interpolate`${aiProjectionQueue.queue.name}`,
      DATABASE_URL: pulumi.interpolate`${PROXY_DATABASE_URL}`,
      ENVIRONMENT: stack,
      RUST_LOG: 'ai_projections_refresh_handler=trace,sqs_client=trace',
    },
    aiProjectionQueueArn: aiProjectionQueue.queue.arn,
    vpc: coparse_api_vpc,
    tags,
  }
);

export const aiProjectionsRefreshTriggerLambdaName =
  aiProjectionsRefreshTrigger.lambda.name;

const MACRO_API_TOKENS = getMacroApiToken();

const documentCognitionService = new DocumentCognitionService(
  `document-cognition-service-${stack}`,
  {
    ecsClusterArn: cloudStorageClusterArn,
    cloudStorageClusterName: cloudStorageClusterName,
    vpc: coparse_api_vpc,
    platform: {
      family: 'linux',
      architecture: 'amd64',
    },
    secretKeyArns: [
      jwtSecretKeyArn,
      MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
      authenticationServiceInternalApiKeyArn,
      ...aiTools.secretArns,
    ],
    serviceContainerPort: 8080,
    healthCheckPath: '/health',
    bucketArns: [...aiTools.bucketArns],
    queueArns: [
      documentTextExtractorQueueArn,
      deleteChatQueueArn,
      searchEventQueueArn,
      notificationIngressQueueArn,
      aiProjectionQueue.queue.arn,
      ...aiTools.queueArns,
    ],
    connectionTablePolicyArn: connectionGatewayTablePolicyArn,
    containerEnvVars: [
      {
        name: 'ENVIRONMENT',
        value: stack,
      },
      // OpenTelemetry / Datadog tracing configuration
      {
        name: 'DD_SERVICE',
        value: 'document-cognition-service',
      },
      {
        name: 'DD_ENV',
        value: stack,
      },
    ],
    isPrivate: false,
    tags,
  }
);

export const documentCognitionServiceSgId =
  documentCognitionService.serviceSg.id;
export const documentCognitionServiceAlbSgId =
  documentCognitionService.serviceAlbSg.id;
export const documentCognitionServiceUrl = pulumi.interpolate`${documentCognitionService.domain}`;
export const documentCognitionServiceRoleArn =
  documentCognitionService.role.arn;
export const aiProjectionQueueArn = aiProjectionQueue.queue.arn;
export const aiProjectionQueueName = aiProjectionQueue.queue.name;
