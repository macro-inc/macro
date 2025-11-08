import * as pulumi from '@pulumi/pulumi';
import { DocumentProcessingService } from './document-processing-service';
import {
  PdfPreprocessLambda,
  transformDatabaseUrl,
} from './pdf-preprocess-lambda';
import {
  DATABASE_URL,
  DATABASE_URL_PROXY,
  DOCUMENT_STORAGE_SERVICE_AUTH_KEY,
  awsRegion,
  stack,
} from './resources/shared';
import { get_coparse_api_vpc } from './resources/vpc';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'document-processing',
};

export const vpc = get_coparse_api_vpc();

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const cloudStorageServiceStack = new pulumi.StackReference(
  'cloud-storage-service',
  {
    name: `macro-inc/cloud-storage-service/${stack}`,
  }
);

export const documentStorageBucketArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('documentStorageBucketArn')
  .apply((documentStorageBucketArn) => documentStorageBucketArn as string);

export const documentStorageBucketId: pulumi.Output<string> = cloudStorageStack
  .getOutput('documentStorageBucketId')
  .apply((documentStorageBucketId) => documentStorageBucketId as string);

export const documentStorageBucketName: pulumi.Output<string> =
  cloudStorageStack
    .getOutput('documentStorageBucketName')
    .apply((documentStorageBucketName) => documentStorageBucketName as string);

export const cloudStorageClusterArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterArn')
  .apply((cloudStorageClusterArn) => cloudStorageClusterArn as string);

export const cloudStorageClusterName: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterName')
  .apply((cloudStorageClusterArn) => cloudStorageClusterArn as string);

export const documentStorageServiceUrl: pulumi.Output<string> =
  cloudStorageServiceStack
    .getOutput('cloudStorageServiceUrl')
    .apply((cloudStorageServiceUrl) => cloudStorageServiceUrl as string);

// Formatted as <host>:<port>
// returns the default endpoint of the cache
export const cloudStorageCacheEndpoint: pulumi.Output<string> =
  cloudStorageStack
    .getOutput('cloudStorageCacheEndpoint')
    .apply((cloudStorageCacheEndpoint) => cloudStorageCacheEndpoint as string);

export const cloudStorageCacheHost = cloudStorageCacheEndpoint.apply(
  (s) => s.split(':')[0]
);
export const cloudStorageCachePort = cloudStorageCacheEndpoint.apply(
  (s) => s.split(':')[1]
);

const webServicesStack = new pulumi.StackReference('macro-app-infra-stack', {
  name: `macro-inc/macro-app-infra/${stack}`,
});

export const pdfServiceUrl: pulumi.Output<string> = webServicesStack
  .getOutput('pdfServiceUrl')
  .apply((pdfServiceUrl) => pdfServiceUrl as string);

export const docxServiceUrl: pulumi.Output<string> = webServicesStack
  .getOutput('docxServiceUrl')
  .apply((docxServiceUrl) => docxServiceUrl as string);

const websocketConnectionStack = new pulumi.StackReference(
  'websocket-connection-stack',
  {
    name: `macro-inc/websocket-connection/${stack}`,
  }
);

export const jobUpdateHandlerLambdaArn: pulumi.Output<string> =
  websocketConnectionStack
    .getOutput('jobUpdateHandlerLambda')
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    .apply((jobUpdateHandlerLambda) => jobUpdateHandlerLambda)
    .apply((jobUpdateHandlerLambda) => jobUpdateHandlerLambda.arn as string);

export const jobUpdateHandlerLambdaName: pulumi.Output<string> =
  websocketConnectionStack
    .getOutput('jobUpdateHandlerLambda')
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    .apply((jobUpdateHandlerLambda) => jobUpdateHandlerLambda)
    .apply((jobUpdateHandlerLambda) => jobUpdateHandlerLambda.name as string);

const pdfPreprocess = new PdfPreprocessLambda<{
  REGION: pulumi.Output<string> | string;
  DATABASE_URL: pulumi.Output<string> | string;
  DATABASE_USER: pulumi.Output<string> | string;
  DATABASE_PASSWORD: pulumi.Output<string> | string;
  JAVA_TOOL_OPTIONS: pulumi.Output<string> | string;
  INCLUDE_DOCUMENT_DATA: pulumi.Output<string> | string;
  WEB_SOCKET_RESPONSE_LAMBDA: pulumi.Output<string> | string;
}>(`pdf-preprocess-lambda-${stack}`, {
  vpc,
  docStorageBucketArn: documentStorageBucketArn,
  jobUpdateHandlerLambdaArn,
  envVars: {
    REGION: awsRegion,
    JAVA_TOOL_OPTIONS: '-Xmx6144m',
    INCLUDE_DOCUMENT_DATA: 'false', // MACRO-3032 we no longer get document data as part of the preprcoess job
    WEB_SOCKET_RESPONSE_LAMBDA: jobUpdateHandlerLambdaName,
    ...transformDatabaseUrl(DATABASE_URL_PROXY),
  },
  tags,
});

export const pdfPreprocessLambdaRoleArn = pdfPreprocess.role.arn;
export const pdfPreprocessLambdaName = pdfPreprocess.lambda.name;
export const pdfPreprocessLambdaArn = pdfPreprocess.lambda.arn;
export const pdfPreprocessLambdaId = pdfPreprocess.lambda.id;

const documentProcessingService = new DocumentProcessingService(
  `document-processing-${stack}`,
  {
    tags,
    ecsClusterArn: cloudStorageClusterArn,
    cloudStorageClusterName,
    vpc,
    platform: {
      family: 'linux',
      architecture: 'amd64',
    },
    documentStorageBucketArn,
    jobUpdateHandlerLambdaArn,
    pdfPreprocessLambdaArn,
    producerServiceEnvVars: [
      { name: 'PORT', value: '8080' },
      { name: 'LOG_LEVEL', value: stack === 'dev' ? 'debug' : 'info' },
      { name: 'ENVIRONMENT', value: stack },
      { name: 'SERVICE_NAME', value: `document-processor-producer-${stack}` },
      { name: 'CONSUMER_HOST', value: 'localhost' },
      { name: 'CONSUMER_PORT', value: '8081' },
      { name: 'JOB_RESPONSE_LAMBDA', value: jobUpdateHandlerLambdaName },
      {
        name: 'REDIS_HOST',
        value: pulumi.interpolate`${cloudStorageCacheHost}`,
      },
      {
        name: 'REDIS_PORT',
        value: pulumi.interpolate`${cloudStorageCachePort}`,
      },
    ],
    consumerServiceEnvVars: [
      { name: 'PORT', value: '8081' },
      { name: 'SERVICE_NAME', value: `document-processor-consumer-${stack}` },
      { name: 'LOG_LEVEL', value: stack === 'dev' ? 'debug' : 'debug' },
      { name: 'ENVIRONMENT', value: stack },
      { name: 'PRODUCER_HOST', value: 'localhost' },
      { name: 'PDF_SERVICE_URL', value: pdfServiceUrl },
      { name: 'DOCX_SERVICE_URL', value: docxServiceUrl },
      {
        name: 'DOCUMENT_STORAGE_SERVICE_URL',
        value: documentStorageServiceUrl,
      },
      {
        name: 'DOCUMENT_STORAGE_SERVICE_AUTH_KEY',
        value: pulumi.interpolate`${DOCUMENT_STORAGE_SERVICE_AUTH_KEY}`,
      },
      { name: 'DOC_STORAGE_BUCKET', value: documentStorageBucketName },
      {
        name: 'DATABASE_URL',
        value: pulumi.interpolate`${DATABASE_URL}`,
      },
      { name: 'JOB_RESPONSE_LAMBDA', value: jobUpdateHandlerLambdaName },
      {
        name: 'PRISMA_CLIENT_MAX_OPEN_CONNECTIONS',
        value: '10',
      },
      {
        name: 'PRISMA_CLIENT_MAX_IDLE_CONNECTIONS',
        value: '3',
      },
      { name: 'PDF_PREPROCESS_LAMBDA', value: pdfPreprocessLambdaName },
    ],
  }
);

export const documentProcessingServiceRoleArn =
  documentProcessingService.role.arn;
export const documentProcessingServiceSecurityGroup =
  documentProcessingService.serviceSecurityGroup.arn;
export const documentProcessingLoadBalancerSecurityGroup =
  documentProcessingService.applicationLoadBalancerSecurityGroup.arn;
export const documentProcessingServiceDomain = documentProcessingService.domain;
