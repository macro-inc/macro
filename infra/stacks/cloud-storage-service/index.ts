import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { createBucket } from '../../packages/resources';
import {
  config,
  getMacroApiToken,
  getMacroNotify,
  getSearchEventQueue,
  getServiceUrl,
  ServiceUrl,
  stack,
} from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { CloudStorageService } from './cloud-storage-service';
import { DeleteChatHandler } from './delete-chat-handler';
import { DeleteDocumentHandler } from './delete-document-handler';
import { attachPolicyToDocxUnzipBucket } from './docx-unzip-bucket';
import {
  DocxUnzipHandlerLambda,
  type DocxUnzipLambdaEnvVars,
} from './docx-unzip-handler-lambda';
import {
  DocumentUploadFinalizerLambda,
  type DocumentUploadFinalizerLambdaEnvVars,
} from './document-upload-finalizer-lambda';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'cloud-storage-service',
};

const MACRO_CACHE = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_cache_secret_key`),
  })
  .apply((secret) => secret.secretString);

const DATABASE_URL_PROXY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_proxy_secret_key`),
  })
  .apply((secret) => secret.secretString);

const JWT_SECRET_KEY = config.require(`jwt_secret_key`);
const jwtSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

const INTERNAL_API_SECRET_KEY = config.require(`internal_api_key`);
const internalApiSecret = aws.secretsmanager.getSecretVersionOutput({
  secretId: INTERNAL_API_SECRET_KEY,
});
const internalApiKeyArn: pulumi.Output<string> = internalApiSecret.apply(
  (secret) => secret.arn
);
const internalApiSecretValue: pulumi.Output<string> = internalApiSecret.apply(
  (secret) => secret.secretString
);

const SYNC_SERVICE_AUTH_KEY = config.require(`sync_service_auth_key`);
const syncServiceAuthSecret = aws.secretsmanager.getSecretVersionOutput({
  secretId: SYNC_SERVICE_AUTH_KEY,
});
const syncServiceAuthKeyArn: pulumi.Output<string> =
  syncServiceAuthSecret.apply((secret) => secret.arn);
const syncServiceAuthKeyValue: pulumi.Output<string> =
  syncServiceAuthSecret.apply((secret) => secret.secretString);

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

const cloudStorageClusterArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterArn')
  .apply((arn) => arn as string);

const cloudStorageClusterName: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterName')
  .apply((arn) => arn as string);

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

const emailServiceStack = new pulumi.StackReference('email-service-stack', {
  name: `macro-inc/email-service/${stack}`,
});

const emailScheduledQueueArn: pulumi.Output<string> = emailServiceStack
  .getOutput('scheduledQueueArn')
  .apply((arn) => arn as string);

const {
  notificationIngressQueueArn,
  notificationApnsVoipPlatformArn: snsApnsVoipPlatformArn,
} = getMacroNotify();

// To re-use this secret name after a destroy, you will need to delete the secret without recovery to prevent conflict:
// aws secretsmanager delete-secret --secret-id ${CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME} --force-delete-without-recovery
const CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME = `linksharing-private-key-${stack}`;

const cloudfrontPrivateKeySecretArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretOutput({
    name: CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME,
  })
  .apply((secret) => secret.arn);

const { searchEventQueueArn } = getSearchEventQueue();

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

const MACRO_API_TOKENS = getMacroApiToken();

const GITHUB_WEBHOOK_SECRET_KEY = config.require('github_webhook_secret_key');
const githubWebhookSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: GITHUB_WEBHOOK_SECRET_KEY })
  .apply((secret) => secret.arn);

const GITHUB_SYNC_APP_PEM_SECRET_KEY = config.require('github_sync_app_pem');
const githubSyncAppPemArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: GITHUB_SYNC_APP_PEM_SECRET_KEY })
  .apply((secret) => secret.arn);

// Cal.com webhook — HMAC secret, resolved at runtime via Secrets Manager.
const CAL_WEBHOOK_SECRET_KEY = config.require('cal_webhook_secret_key');
const calWebhookSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: CAL_WEBHOOK_SECRET_KEY })
  .apply((secret) => secret.arn);

// Cal.com eventTypeId → Meta content_name JSON map, resolved at runtime.
const CAL_EVENT_TYPE_CONTENT_NAMES_KEY = config.require(
  'cal_event_type_content_names_key'
);
const calEventTypeContentNamesKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: CAL_EVENT_TYPE_CONTENT_NAMES_KEY })
  .apply((secret) => secret.arn);

const callRecordingStack = new pulumi.StackReference('call-recording-stack', {
  name: `macro-inc/call-recording/${stack}`,
});

const callRecordingCrudPolicyArn: pulumi.Output<string> = callRecordingStack
  .getOutput('crudPolicyArn')
  .apply((t) => t as string);

const cloudStorageService = new CloudStorageService(
  `cloud-storage-service-${stack}`,
  {
    ecsClusterArn: cloudStorageClusterArn,
    cloudStorageClusterName: cloudStorageClusterName,
    queueArns: [
      searchEventQueueArn,
      deleteDocumentHandler.queue.arn,
      notificationIngressQueueArn,
      contactsQueueArn,
      emailScheduledQueueArn,
    ],
    vpc: coparse_api_vpc,
    platform: {
      family: 'linux',
      architecture: 'amd64',
    },
    documentStorageBucketArn,
    docxUploadBucketArn,
    serviceContainerPort: 8080,
    healthCheckPath: '/health',
    secretKeyArns: [
      jwtSecretKeyArn,
      documentStoragePermissionsKeyArn,
      cloudfrontPrivateKeySecretArn,
      internalApiKeyArn,
      syncServiceAuthKeyArn,
      MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
      githubWebhookSecretKeyArn,
      githubSyncAppPemArn,
      calWebhookSecretKeyArn,
      calEventTypeContentNamesKeyArn,
    ],
    callRecordingCrudPolicyArn,
    snsPlatformArns: [snsApnsVoipPlatformArn],
    containerEnvVars: [
      // OpenTelemetry / Datadog tracing configuration
      {
        name: 'DD_SERVICE',
        value: 'cloud-storage-service',
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
  REDIS_URI: pulumi.interpolate`redis://${MACRO_CACHE}`,
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

// ------------------------------------------- Document Upload Finalizer -------------------------------------------
const documentUploadFinalizerEnvVars: DocumentUploadFinalizerLambdaEnvVars = {
  DATABASE_URL: pulumi.interpolate`${DATABASE_URL_PROXY}`,
  INTERNAL_API_SECRET_KEY: pulumi.interpolate`${internalApiSecretValue}`,
  SYNC_SERVICE_AUTH_KEY: pulumi.interpolate`${syncServiceAuthKeyValue}`,
  LEXICAL_SERVICE_URL: getServiceUrl(ServiceUrl.LEXICAL_SERVICE_URL),
  SYNC_SERVICE_URL: getServiceUrl(ServiceUrl.SYNC_SERVICE_URL),
  RUST_LOG: 'document_upload_finalizer_handler=info,documents=info',
};

const documentUploadFinalizer = new DocumentUploadFinalizerLambda(
  `document-upload-finalizer-${stack}`,
  {
    documentStorageBucketArn,
    envVars: documentUploadFinalizerEnvVars,
    vpc: coparse_api_vpc,
    tags,
  }
);

export const documentUploadFinalizerRoleArn = documentUploadFinalizer.role.arn;
export const documentUploadFinalizerName = documentUploadFinalizer.lambda.name;
export const documentUploadFinalizerArn = documentUploadFinalizer.lambda.arn;

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
