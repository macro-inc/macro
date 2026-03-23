import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { MemoryScheduler } from './memory-scheduler';
import { MemoryWorker } from './memory-worker';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'memory-generation',
};

// Secrets
const DATABASE_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('macro_db_proxy_secret_key'),
  })
  .apply((secret) => secret.secretString);

const ANTHROPIC_API_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('anthropic_api_key'),
  })
  .apply((secret) => secret.secretString);

const INTERNAL_AUTH_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('internal_auth_key'),
  })
  .apply((secret) => secret.secretString);

const OPEN_ROUTER_API_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('open-router-api-key'),
  })
  .apply((secret) => secret.secretString);

// Cross-stack references
const cloudStorageServiceStack = new pulumi.StackReference(
  'cloud-storage-service',
  {
    name: `macro-inc/cloud-storage-service/${stack}`,
  }
);

const documentStorageBucketArn: pulumi.Output<string> =
  cloudStorageServiceStack
    .getOutput('documentStorageBucketArn')
    .apply((arn) => arn as string);

const documentStorageBucketId: pulumi.Output<string> =
  cloudStorageServiceStack
    .getOutput('documentStorageBucketId')
    .apply((id) => id as string);

const docxUploadBucketArn: pulumi.Output<string> = cloudStorageServiceStack
  .getOutput('docxUploadBucketArn')
  .apply((arn) => arn as string);

const docxUploadBucketName: pulumi.Output<string> = cloudStorageServiceStack
  .getOutput('docxUploadBucketName')
  .apply((name) => name as string);

const documentStorageServiceUrl = `https://cloud-storage${
  stack === 'prod' ? '' : `-${stack}`
}.macro.com`;

const linksharingStack = new pulumi.StackReference('linksharing-stack', {
  name: `macro-inc/link-sharing/${stack}`,
});

const cloudfrontDistributionUrl: pulumi.Output<string> = linksharingStack
  .getOutput('cloudfrontDistributionUrl')
  .apply((url) => url as string);

const cloudfrontSignerPublicKeyId: pulumi.Output<string> = linksharingStack
  .getOutput('cloudfrontDistributionPublicKeyId')
  .apply((key) => key as string);

const CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME = `linksharing-private-key-${stack}`;

const SYNC_SERVICE_URL = `https://sync-service-${
  stack === 'dev' ? 'dev3' : 'prod2'
}.macroverse.workers.dev`;

const vpc = get_coparse_api_vpc();

// Worker (creates the SQS queue)
const memoryWorker = new MemoryWorker(`memory-worker-${stack}`, {
  envVars: {
    DATABASE_URL: pulumi.interpolate`${DATABASE_URL}`,
    ANTHROPIC_API_KEY: pulumi.interpolate`${ANTHROPIC_API_KEY}`,
    OPEN_ROUTER_API_KEY: pulumi.interpolate`${OPEN_ROUTER_API_KEY}`,
    INTERNAL_API_SECRET_KEY: pulumi.interpolate`${INTERNAL_AUTH_KEY}`,
    DOCUMENT_STORAGE_SERVICE_URL: documentStorageServiceUrl,
    SEARCH_SERVICE_URL: documentStorageServiceUrl,
    EMAIL_SERVICE_URL: `https://email-service${
      stack === 'prod' ? '' : `-${stack}`
    }.macro.com`,
    SYNC_SERVICE_URL,
    DOCUMENT_COGNITION_SERVICE_URL: documentStorageServiceUrl,
    STATIC_FILE_SERVICE_URL: `https://static-file-service${
      stack === 'prod' ? '' : `-${stack}`
    }.macro.com`,
    COMMS_SERVICE_URL: documentStorageServiceUrl,
    LEXICAL_SERVICE_URL: `https://lexical-service-${stack}.macroverse.workers.dev`,
    DOCUMENT_STORAGE_BUCKET: pulumi.interpolate`${documentStorageBucketId}`,
    DOCX_DOCUMENT_UPLOAD_BUCKET: pulumi.interpolate`${docxUploadBucketName}`,
    DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL:
      pulumi.interpolate`${cloudfrontDistributionUrl}`,
    DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID:
      pulumi.interpolate`${cloudfrontSignerPublicKeyId}`,
    DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME:
      CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME,
    ENVIRONMENT: stack,
    RUST_LOG: 'memory_worker=info,memory=info,ai=info',
  },
  vpc,
  bucketArns: [documentStorageBucketArn, docxUploadBucketArn],
  tags,
});

// Scheduler (triggers weekly, fans out to worker queue)
const memoryScheduler = new MemoryScheduler(`memory-scheduler-${stack}`, {
  envVars: {
    DATABASE_URL: pulumi.interpolate`${DATABASE_URL}`,
    MEMORY_GENERATION_QUEUE_URL: memoryWorker.queue.url,
    ENVIRONMENT: stack,
    RUST_LOG: 'memory_scheduler=info,memory=info',
  },
  memoryGenerationQueueArn: memoryWorker.queue.arn,
  vpc,
  tags,
});

// Exports
export const memoryGenerationQueueArn = memoryWorker.queue.arn;
export const memoryGenerationQueueName = memoryWorker.queue.name;
export const memoryGenerationQueueUrl = memoryWorker.queue.url;
export const memorySchedulerLambdaName = memoryScheduler.lambda.name;
export const memoryWorkerLambdaName = memoryWorker.lambda.name;
