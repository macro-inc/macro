import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import {
  config,
  getMacroApiToken,
  getMacroNotify,
  getSearchEventQueue,
  stack,
} from '@shared';
import { get_coparse_api_vpc } from '@vpc';
import { CommsService } from './comms-service';

const tags = {
  environment: stack,
  tech_lead: 'teo',
  project: 'comms-service',
};

export const coparse_api_vpc = get_coparse_api_vpc();

const LEGACY_JWT_SECRET = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.get(`legacy_jwt_secret_key`) ?? '',
  })
  .apply((secret) => secret.secretString);

const AUTHENTICATION_SERVICE_SECRET_KEY = config.require(
  `authentication_service_secret_key`
);
const authenticationServiceSecretKey: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: AUTHENTICATION_SERVICE_SECRET_KEY })
  .apply((secret) => secret.arn);
const JWT_SECRET_KEY = config.require(`jwt_secret_key`);
const jwtSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

const MACRO_DB_URL_SECRET_NAME = config.require(`macro_db_secret_key`);
const MACRO_DB_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: MACRO_DB_URL_SECRET_NAME,
  })
  .apply((secret) => secret.secretString);
const macroDbUrlArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: MACRO_DB_URL_SECRET_NAME })
  .apply((secret) => secret.arn);

const fusionauthClientIdSecretKey = config.require(`fusionauth_client_id`);

const FUSIONAUTH_CLIENT_ID = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: fusionauthClientIdSecretKey,
  })
  .apply((secret) => secret.secretString);
const FUSIONAUTH_ISSUER = config.require(`fusionauth_issuer`);

const INTERNAL_AUTH_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.get(`internal_auth_key`) ?? '',
  })
  .apply((secret) => secret.secretString);

const DOCUMENT_STORAGE_PERMISSIONS_KEY = config.require(
  `document_storage_permissions_key`
);
const documentStoragePermissionsKeyArn: pulumi.Output<string> =
  aws.secretsmanager
    .getSecretVersionOutput({ secretId: DOCUMENT_STORAGE_PERMISSIONS_KEY })
    .apply((secret) => secret.arn);

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const connectionGatewayStack = new pulumi.StackReference(
  'connection-gateway-stack',
  {
    name: `macro-inc/connection-gateway/${stack}`,
  }
);

const connectionGatewayEndpoint = connectionGatewayStack
  .getOutput('connectionGatewayUrl')
  .apply((arn) => arn as string);

const cloudStorageClusterArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterArn')
  .apply((arn) => arn as string);

const cloudStorageClusterName: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterName')
  .apply((arn) => arn as string);

const { notificationQueueName, notificationQueueArn } = getMacroNotify();

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

const { searchEventQueueName, searchEventQueueArn } = getSearchEventQueue();

const MACRO_API_TOKENS = getMacroApiToken();

const secretKeyArns = [
  pulumi.interpolate`${jwtSecretKeyArn}`,
  pulumi.interpolate`${authenticationServiceSecretKey}`,
  pulumi.interpolate`${documentStoragePermissionsKeyArn}`,
  pulumi.interpolate`${macroDbUrlArn}`,
  pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenPublicKeyArn}`,
];

const queueArns = [
  pulumi.interpolate`${notificationQueueArn}`,
  pulumi.interpolate`${contactsQueueArn}`,
  pulumi.interpolate`${searchEventQueueArn}`,
];

const commsService = new CommsService(`comms-service-${stack}`, {
  ecsClusterArn: cloudStorageClusterArn,
  cloudStorageClusterName: cloudStorageClusterName,
  vpc: coparse_api_vpc,
  platform: {
    family: 'linux',
    architecture: 'amd64',
  },
  queueArns,
  serviceContainerPort: 8080,
  healthCheckPath: '/health',
  containerEnvVars: [
    {
      name: 'DATABASE_URL',
      value: pulumi.interpolate`${MACRO_DB_URL}`,
    },
    {
      name: 'ENVIRONMENT',
      value: stack,
    },
    {
      name: 'RUST_LOG',
      value: `comms_service=${
        stack === 'prod' ? 'info' : 'debug'
      },tower_http=info,document_storage_service_client=info`,
    },
    {
      name: 'LEGACY_JWT_SECRET',
      value: pulumi.interpolate`${LEGACY_JWT_SECRET}`,
    },
    {
      name: 'INTERNAL_API_SECRET_KEY',
      value: pulumi.interpolate`${INTERNAL_AUTH_KEY}`,
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
      name: 'CONNECTION_GATEWAY_URL',
      value: pulumi.interpolate`${connectionGatewayEndpoint}`,
    },
    {
      name: 'NOTIFICATION_QUEUE',
      value: pulumi.interpolate`${notificationQueueName}`,
    },
    {
      name: 'DOCUMENT_STORAGE_SERVICE_URL',
      value: `https://cloud-storage${stack === 'prod' ? '' : `-${stack}`}.macro.com`,
    },
    {
      name: 'CONTACTS_QUEUE',
      value: pulumi.interpolate`${contactsQueueName}`,
    },
    {
      name: 'AUTHENTICATION_SERVICE_SECRET_KEY',
      value: pulumi.interpolate`${AUTHENTICATION_SERVICE_SECRET_KEY}`,
    },
    {
      name: 'AUTHENTICATION_SERVICE_URL',
      value: `https://auth-service${stack === 'prod' ? '' : `-${stack}`}.macro.com`,
    },
    {
      name: 'DOCUMENT_PERMISSION_JWT_SECRET_KEY',
      value: pulumi.interpolate`${DOCUMENT_STORAGE_PERMISSIONS_KEY}`,
    },
    {
      name: 'SEARCH_EVENT_QUEUE',
      value: pulumi.interpolate`${searchEventQueueName}`,
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
      name: 'MACRO_DB_URL',
      value: pulumi.interpolate`${MACRO_DB_URL_SECRET_NAME}`,
    },
  ],
  isPrivate: false,
  tags,
  secretKeyArns,
});

export const commsServiceSgId = commsService.serviceSg.id;
export const commsServiceAlbSgId = commsService.serviceAlbSg.id;
export const commsServiceUrl = pulumi.interpolate`${commsService.domain}`;
