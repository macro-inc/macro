import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { createBucket, DynamoDBTable } from '@resources';
import {
  config,
  getMacroApiToken,
  getMacroNotify,
  getSearchEventQueue,
  stack,
} from '@shared';
import { get_coparse_api_vpc } from '@vpc';
import { CloudStorageService } from './cloud-storage-service';
import { DeleteChatHandler } from './delete-chat-handler';
import { DeleteDocumentHandler } from './delete-document-handler';
import { attachPolicyToDocxUnzipBucket } from './docx-unzip-bucket';
import {
  DocxUnzipHandlerLambda,
  type DocxUnzipLambdaEnvVars,
} from './docx-unzip-handler-lambda';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'cloud-storage-service',
};

const DATABASE_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_secret_key`),
  })
  .apply((secret) => secret.secretString);

const DATABASE_URL_PROXY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_proxy_secret_key`),
  })
  .apply((secret) => secret.secretString);

const DOCUMENT_STORAGE_SERVICE_AUTH_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.get(`document_storage_service_auth_key`) ?? '',
  })
  .apply((secret) => secret.secretString);

const JWT_SECRET_KEY = config.require(`jwt_secret_key`);
const jwtSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

const INTERNAL_API_SECRET_KEY = config.require(`internal_api_key`);
const internalApiKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: INTERNAL_API_SECRET_KEY })
  .apply((secret) => secret.arn);

const SYNC_SERVICE_AUTH_KEY = config.require(`sync_service_auth_key`);
const syncServiceAuthKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: SYNC_SERVICE_AUTH_KEY })
  .apply((secret) => secret.arn);

const fusionauthClientIdSecretKey = config.require(`fusionauth_client_id`);

const FUSIONAUTH_CLIENT_ID = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: fusionauthClientIdSecretKey,
  })
  .apply((secret) => secret.secretString);
const FUSIONAUTH_ISSUER = config.require(`fusionauth_issuer`);

const DOCUMENT_STORAGE_PERMISSIONS_KEY = config.require(
  `document_storage_permissions_key`
);
const documentStoragePermissionsKeyArn: pulumi.Output<string> =
  aws.secretsmanager
    .getSecretVersionOutput({ secretId: DOCUMENT_STORAGE_PERMISSIONS_KEY })
    .apply((secret) => secret.arn);

export const coparse_api_vpc = get_coparse_api_vpc();

const websocketConnectionStack = new pulumi.StackReference(
  'websocket-connection-stack',
  {
    name: `macro-inc/websocket-connection/${stack}`,
  }
);
export const jobUpdateHandlerLambdaArn: pulumi.Output<string> =
  websocketConnectionStack
    .getOutput('jobUpdateHandlerLambda')
    .apply((jobUpdateHandlerLambda) => jobUpdateHandlerLambda.arn as string);

export const jobUpdateHandlerLambdaName = jobUpdateHandlerLambdaArn.apply(
  (arn) => {
    const jobUpdateHandlerLambdaArnSplit = arn.split(':');
    return jobUpdateHandlerLambdaArnSplit[
      jobUpdateHandlerLambdaArnSplit.length - 1
    ];
  }
);

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const documentStorageBucketArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('documentStorageBucketArn')
  .apply((arn) => arn as string);

const documentStorageBucketId: pulumi.Output<string> = cloudStorageStack
  .getOutput('documentStorageBucketId')
  .apply((id) => id as string);

const cloudStorageCacheEndpoint: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageCacheEndpoint')
  .apply((arn) => arn as string);

const cloudStorageClusterArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterArn')
  .apply((arn) => arn as string);

const cloudStorageClusterName: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterName')
  .apply((arn) => arn as string);

const linksharingStack = new pulumi.StackReference('linksharing-stack', {
  name: `macro-inc/link-sharing/${stack}`,
});

const cloudfronDistributionUrl: pulumi.Output<string> = linksharingStack
  .getOutput('cloudfrontDistributionUrl')
  .apply((url) => url as string);

const cloudfronSignerPublicKeyId: pulumi.Output<string> = linksharingStack
  .getOutput('cloudfrontDistributionPublicKeyId')
  .apply((key) => key as string);

const { notificationQueueName, notificationQueueArn } = getMacroNotify();

// To re-use this secret name after a destroy, you will need to delete the secret without recovery to prevent conflict:
// aws secretsmanager delete-secret --secret-id ${CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME} --force-delete-without-recovery
const CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME = `linksharing-private-key-${stack}`;

const cloudfrontPrivateKeySecretArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretOutput({
    name: CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME,
  })
  .apply((secret) => secret.arn);

const { searchEventQueueName, searchEventQueueArn } = getSearchEventQueue();

const docxUploadBucket = createBucket({
  id: `docx-upload-${stack}`,
  bucketName: `docx-upload-${stack}`,
  transferAcceleration: false,
  lifecycleRules: [
    {
      id: `docx-upload-${stack}-cleanup`,
      enabled: true,
      expiration: {
        days: 1,
      },
    },
  ],
});

const bulkUploadStack = new pulumi.StackReference('bulk-upload-stack', {
  name: `macro-inc/bulk-upload/${stack}`,
});
export const bulkUploadLambdaRoleArn = bulkUploadStack
  .getOutput('uploadExtractHandlerLambdaRoleArn')
  .apply((arn) => arn as string);

export const docxUploadBucketArn = docxUploadBucket.arn;
export const docxUploadBucketName = docxUploadBucket.id;

const deleteDocumentHandler = new DeleteDocumentHandler(
  `delete-document-handler-${stack}`,
  {
    tags,
  }
);

export const deleteDocumentQueueArn = deleteDocumentHandler.queue.arn;
export const deleteDocumentQueueName = deleteDocumentHandler.queue.name;

const deleteChatHandler = new DeleteChatHandler(
  `delete-chat-handler-${stack}`,
  {
    envVars: {
      DATABASE_URL: pulumi.interpolate`${DATABASE_URL_PROXY}`,
      ENVIRONMENT: stack,
      RUST_LOG: 'delete_chat_handler=info',
    },
    vpc: coparse_api_vpc,
    tags,
  }
);

export const deleteChatHandlerRoleArn = deleteChatHandler.role.arn;
export const deleteChatHandlerLambdaName = deleteChatHandler.lambda.name;
export const deleteChatQueueArn = deleteChatHandler.queue.arn;
export const deleteChatQueueName = deleteChatHandler.queue.name;

/// Affiliate Tracking
const affiliateTrackingTable = new DynamoDBTable('affiliate-tracking-table', {
  baseName: 'affiliate-tracking-table',
  attributes: [
    { name: 'PK', type: 'S' },
    { name: 'SK', type: 'S' },
  ] as aws.types.input.dynamodb.TableAttribute[],
  hashKey: 'PK',
  rangeKey: 'SK',
});

const MACRO_API_TOKENS = getMacroApiToken();

const cloudStorageService = new CloudStorageService(
  `cloud-storage-service-${stack}`,
  {
    ecsClusterArn: cloudStorageClusterArn,
    cloudStorageClusterName: cloudStorageClusterName,
    searchEventQueueArn,
    vpc: coparse_api_vpc,
    platform: {
      family: 'linux',
      architecture: 'amd64',
    },
    documentStorageBucketArn,
    docxUploadBucketArn,
    serviceContainerPort: 8080,
    healthCheckPath: '/health',
    deleteDocumentQueueArn: deleteDocumentHandler.queue.arn,
    secretKeyArns: [
      jwtSecretKeyArn,
      documentStoragePermissionsKeyArn,
      cloudfrontPrivateKeySecretArn,
      internalApiKeyArn,
      syncServiceAuthKeyArn,
      MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
    ],
    notificationQueueArn,
    affiliateTrackingTableArn: affiliateTrackingTable.table.arn,
    containerEnvVars: [
      {
        name: 'DATABASE_URL',
        value: pulumi.interpolate`${DATABASE_URL}`,
      },
      {
        name: 'REDIS_URI',
        value: pulumi.interpolate`rediss://${cloudStorageCacheEndpoint}`,
      },
      {
        name: 'ENVIRONMENT',
        value: stack,
      },
      {
        name: 'RUST_LOG',
        value: `document_storage_service=${
          stack === 'prod' ? 'debug' : 'trace'
        },tower_http=info,macro_share_permissions=${
          stack === 'prod' ? 'error' : 'trace'
        },macro_project_utils=info,macro_notify=info`,
      },
      {
        name: 'DOCUMENT_STORAGE_BUCKET',
        value: pulumi.interpolate`${documentStorageBucketId}`,
      },
      {
        name: 'DOCX_DOCUMENT_UPLOAD_BUCKET',
        value: pulumi.interpolate`${docxUploadBucketName}`,
      },
      {
        name: 'DOCUMENT_DELETE_QUEUE',
        value: pulumi.interpolate`${deleteDocumentQueueName}`,
      },
      {
        name: 'DOCUMENT_STORAGE_SERVICE_AUTH_KEY',
        value: pulumi.interpolate`${DOCUMENT_STORAGE_SERVICE_AUTH_KEY}`,
      },
      {
        name: 'DOCUMENT_LIMIT',
        value: stack === 'prod' ? '5000' : '5000',
      },
      {
        name: 'PRESIGNED_URL_EXPIRY_SECONDS',
        value: '900',
      },
      {
        name: 'PRESIGNED_URL_BROWSER_CACHE_EXPIRY_SECONDS',
        value: '840',
      },
      {
        name: 'CLOUDFRONT_DISTRIBUTION_URL',
        value: pulumi.interpolate`${cloudfronDistributionUrl}`,
      },
      {
        name: 'CLOUDFRONT_SIGNER_PUBLIC_KEY_ID',
        value: pulumi.interpolate`${cloudfronSignerPublicKeyId}`,
      },
      {
        name: 'CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME',
        value: pulumi.interpolate`${CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME}`,
      },
      { name: 'ISSUER', value: pulumi.interpolate`${FUSIONAUTH_ISSUER}` },
      {
        name: 'JWT_SECRET_KEY',
        value: pulumi.interpolate`${JWT_SECRET_KEY}`,
      },
      {
        name: 'AUDIENCE',
        value: pulumi.interpolate`${FUSIONAUTH_CLIENT_ID}`,
      },
      {
        name: 'NOTIFICATION_QUEUE',
        value: pulumi.interpolate`${notificationQueueName}`,
      },
      {
        name: 'SEARCH_EVENT_QUEUE',
        value: pulumi.interpolate`${searchEventQueueName}`,
      },
      {
        name: 'COMMS_SERVICE_URL',
        value: `https://comms-service${
          stack === 'prod' ? '' : `-${stack}`
        }.macro.com`,
      },
      {
        name: 'EMAIL_SERVICE_URL',
        value: `https://email-service${
          stack === 'prod' ? '' : `-${stack}`
        }.macro.com`,
      },
      {
        name: 'DOCUMENT_PERMISSION_JWT_SECRET_KEY',
        value: pulumi.interpolate`${DOCUMENT_STORAGE_PERMISSIONS_KEY}`,
      },
      {
        name: 'AFFILIATE_USERS_TABLE',
        value: pulumi.interpolate`${affiliateTrackingTable.table.name}`,
      },
      {
        name: 'INTERNAL_API_SECRET_KEY',
        value: pulumi.interpolate`${INTERNAL_API_SECRET_KEY}`,
      },
      {
        name: 'CONNECTION_GATEWAY_URL',
        value: `https://connection-gateway${
          stack === 'prod' ? '' : `-${stack}`
        }.macro.com`,
      },
      {
        name: 'BULK_UPLOAD_REQUESTS_TABLE',
        // TODO: this should be interpolated from the bulk upload resource
        value: `bulk-upload-${stack}`,
      },
      {
        name: 'UPLOAD_STAGING_BUCKET',
        // TODO: this should be interpolated from the bulk upload resource
        value: `bulk-upload-staging-${stack}`,
      },
      {
        name: 'SYNC_SERVICE_AUTH_KEY',
        value: pulumi.interpolate`${SYNC_SERVICE_AUTH_KEY}`,
      },
      {
        name: 'SYNC_SERVICE_URL',
        value: `https://sync-service-${stack}.macroverse.workers.dev`,
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
        name: 'FRECENCY_TABLE_NAME',
        value: `frecency-${stack}`,
      },
    ],
    isPrivate: false,
    tags,
  }
);

export const cloudStorageServiceRoleArn = cloudStorageService.role.arn;
export const cloudStorageServiceSgId = cloudStorageService.serviceSg.id;
export const cloudStorageServiceAlbSgId = cloudStorageService.serviceAlbSg.id;
export const cloudStorageServiceUrl = pulumi.interpolate`${cloudStorageService.domain}`;

const convertServiceStack = new pulumi.StackReference('convert-service-stack', {
  name: `macro-inc/convert-service/${stack}`,
});

const convertServiceRoleArn: pulumi.Output<string> = convertServiceStack
  .getOutput('convertServiceRoleArn')
  .apply((arn) => arn as string);

const convertQueueName: pulumi.Output<string> = convertServiceStack
  .getOutput('convertQueueName')
  .apply((name) => name as string);

const convertQueueArn: pulumi.Output<string> = convertServiceStack
  .getOutput('convertQueueArn')
  .apply((arn) => arn as string);

// ------------------------------------------- DOCX Unzip -------------------------------------------
const docxUnzipHandlerEnvVars: DocxUnzipLambdaEnvVars = {
  DATABASE_URL: pulumi.interpolate`${DATABASE_URL_PROXY}`,
  REDIS_URI: pulumi.interpolate`rediss://${cloudStorageCacheEndpoint}`,
  ENVIRONMENT: stack,
  RUST_LOG: 'docx_unzip_handler=info',
  DOCUMENT_STORAGE_BUCKET: pulumi.interpolate`${documentStorageBucketId}`,
  DOCX_DOCUMENT_UPLOAD_BUCKET: pulumi.interpolate`${docxUploadBucketName}`,
  WEB_SOCKET_RESPONSE_LAMBDA: pulumi.interpolate`${jobUpdateHandlerLambdaName}`,
  CONVERT_QUEUE: pulumi.interpolate`${convertQueueName}`,
};

const docxUnzipHandler = new DocxUnzipHandlerLambda(
  `docx-unzip-handler-${stack}`,
  {
    docStorageBucketArn: documentStorageBucketArn,
    docxUploadBucketArn: docxUploadBucketArn,
    convertQueueArn,
    jobUpdateHandlerLambdaArn,
    envVars: docxUnzipHandlerEnvVars,
    vpc: coparse_api_vpc,
    tags,
  }
);

export const docxUnzipHandlerRoleArn = docxUnzipHandler.role.arn;
export const docxUnzipHandlerName = docxUnzipHandler.lambda.name;

// attach lambda to s3 event
// disabling in dev to test theory of editor crash in web app and potentially use a new paradigm for docx file upload
new aws.s3.BucketEventSubscription(
  `docx-upload-event-${stack}`,
  docxUploadBucket,
  docxUnzipHandler.lambda,
  {
    events: ['s3:ObjectCreated:*'],
  }
);

// Attach bucket policy to docx upload bucket
attachPolicyToDocxUnzipBucket({
  bucket: docxUploadBucket,
  cloudStorageServiceRoleArn,
  docxUnzipLambdaRoleArn: docxUnzipHandler.role.arn,
  bulkUploadLambdaRoleArn,
  convertServiceRoleArn,
});
