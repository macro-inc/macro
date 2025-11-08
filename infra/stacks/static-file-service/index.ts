import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, getMacroApiToken } from '@shared';
import { get_coparse_api_vpc } from '@vpc';
import {
  SERVICE_NAME,
  SERVICE_URL,
  STATIC_FILE_BUCKET,
  StaticFileService,
} from './static-file-service';

const stack = pulumi.getStack();

const tags = {
  environment: stack,
  tech_lead: 'ehayes-static',
  project: SERVICE_NAME,
};

const JWT_SECRET_KEY = config.require(`jwt_secret_key`);
const jwtSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

const INTERNAL_API_SECRET_KEY = config.require(`internal_api_key`);
const internalApiKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: INTERNAL_API_SECRET_KEY })
  .apply((secret) => secret.arn);

export const coparse_api_vpc = get_coparse_api_vpc();

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const cloudStorageClusterArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterArn')
  .apply((arn) => arn as string);

const cloudStorageClusterName: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterName')
  .apply((arn) => arn as string);

const FUSIONAUTH_CLIENT_ID = config.require(`fusionauth_client_id`);
const FUSIONAUTH_ISSUER = config.require(`fusionauth_issuer`);

const MACRO_API_TOKENS = getMacroApiToken();

const containerEnvVars = [
  {
    name: 'ENVIRONMENT',
    value: stack,
  },
  {
    name: 'JWT_SECRET_KEY',
    value: pulumi.interpolate`${JWT_SECRET_KEY}`,
  },
  {
    name: 'AUDIENCE',
    value: pulumi.interpolate`${FUSIONAUTH_CLIENT_ID}`,
  },

  { name: 'ISSUER', value: pulumi.interpolate`${FUSIONAUTH_ISSUER}` },

  { name: 'SERVICE_URL', value: pulumi.interpolate`${SERVICE_URL}` },
  {
    name: 'STATIC_STORAGE_BUCKET',
    value: pulumi.interpolate`${STATIC_FILE_BUCKET}`,
  },
  {
    name: 'INTERNAL_API_SECRET_KEY',
    value: pulumi.interpolate`${INTERNAL_API_SECRET_KEY}`,
  },
  {
    name: 'RUST_LOG',
    value: `static_file_service=${stack === 'prod' ? 'error' : 'info'}`,
  },
  {
    name: 'MACRO_API_TOKEN_ISSUER',
    value: pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenIssuer}`,
  },
  {
    name: 'MACRO_API_TOKEN_PUBLIC_KEY',
    value: pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenPublicKey}`,
  },
];

/// available as env var: DYNAMODB_TABLE_NAME
const dynamoDbTableName = `static-file-metadata-${stack}`;

const staticFileService = new StaticFileService(`${SERVICE_NAME}-${stack}`, {
  cloudStorageClusterName,
  ecsClusterArn: cloudStorageClusterArn,
  vpc: coparse_api_vpc,
  platform: {
    family: 'linux',
    architecture: 'amd64',
  },
  secretKeyArns: [
    jwtSecretKeyArn,
    internalApiKeyArn,
    MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
  ],
  healthCheckPath: '/api/health',
  serviceContainerPort: 8080,
  tags,
  containerEnvVars,
  isPrivate: false,
  dynamoDbTableName,
});

// unused + cringe
export const staticFileServiceSgId = staticFileService.serviceAlbSg.id;
export const staticFileServiceAlbSgId = staticFileService.serviceAlbSg.id;
export const staticFileServiceUrl = pulumi.interpolate`${staticFileService.domain}`;
