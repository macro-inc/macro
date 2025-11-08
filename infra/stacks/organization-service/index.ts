import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, getMacroApiToken, stack } from '@shared';
import { get_coparse_api_vpc } from '@vpc';
import { OrganizationService } from './organization-service';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'organization-service',
};

const DATABASE_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_secret_key`),
  })
  .apply((secret) => secret.secretString);

const MACRO_CACHE = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_cache_secret_key`),
  })
  .apply((secret) => secret.secretString);

const LEGACY_JWT_SECRET = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`legacy_jwt_secret_key`),
  })
  .apply((secret) => secret.secretString);

const DOCUMENT_STORAGE_SERVICE_AUTH_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`document_storage_service_auth_key`),
  })
  .apply((secret) => secret.secretString);

const JWT_SECRET_KEY = config.require(`jwt_secret_key`);
const jwtSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

const AUTH_INTERNAL_AUTH_SECRET_KEY = config.require(
  `authentication_service_internal_api_key`
);
const authInternalSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: AUTH_INTERNAL_AUTH_SECRET_KEY })
  .apply((secret) => secret.arn);

const FUSIONAUTH_CLIENT_ID = config.require(`fusionauth_client_id`);
const FUSIONAUTH_ISSUER = config.require(`fusionauth_issuer`);

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

const cloudStorageServiceStack = new pulumi.StackReference(
  'cloud-storage-service-stack',
  {
    name: `macro-inc/cloud-storage-service/${stack}`,
  }
);

export const cloudStorageServiceUrl: pulumi.Output<string> =
  cloudStorageServiceStack
    .getOutput('cloudStorageServiceUrl')
    .apply((url) => url as string);

export const INVITE_EMAIL = `invite${
  stack === 'prod' ? '' : `-${stack}`
}@macro.com`;

const MACRO_API_TOKENS = getMacroApiToken();

const organizationService = new OrganizationService(
  `organization-service-${stack}`,
  {
    ecsClusterArn: cloudStorageClusterArn,
    cloudStorageClusterName: cloudStorageClusterName,
    secretKeyArns: [
      jwtSecretKeyArn,
      authInternalSecretKeyArn,
      MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
    ],
    vpc: coparse_api_vpc,
    platform: {
      family: 'linux',
      architecture: 'amd64',
    },
    serviceContainerPort: 8080,
    healthCheckPath: '/health',
    containerEnvVars: [
      {
        name: 'DATABASE_URL',
        value: pulumi.interpolate`${DATABASE_URL}`,
      },
      {
        name: 'REDIS_URI',
        value: pulumi.interpolate`redis://${MACRO_CACHE}`,
      },
      {
        name: 'LEGACY_JWT_SECRET',
        value: pulumi.interpolate`${LEGACY_JWT_SECRET}`,
      },
      {
        name: 'INTERNAL_API_SECRET_KEY',
        value: pulumi.interpolate`${DOCUMENT_STORAGE_SERVICE_AUTH_KEY}`,
      },
      {
        name: 'DSS_URL',
        value: pulumi.interpolate`${cloudStorageServiceUrl}`,
      },
      {
        name: 'INVITE_EMAIL',
        value: pulumi.interpolate`${INVITE_EMAIL}`,
      },
      {
        name: 'ENVIRONMENT',
        value: stack,
      },
      {
        name: 'RUST_LOG',
        value: `organization_service=${
          stack === 'prod' ? 'debug' : 'trace'
        },tower_http=debug`,
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
        name: 'AUTH_URL',
        value: `https://auth-service${stack === 'prod' ? '' : '-dev'}.macro.com`,
      },
      {
        name: 'AUTH_INTERNAL_AUTH_SECRET_KEY',
        value: pulumi.interpolate`${AUTH_INTERNAL_AUTH_SECRET_KEY}`,
      },
      {
        name: 'MACRO_API_TOKEN_ISSUER',
        value: pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenIssuer}`,
      },
      {
        name: 'MACRO_API_TOKEN_PUBLIC_KEY',
        value: pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenPublicKey}`,
      },
    ],
    isPrivate: false,
    tags,
  }
);

export const organizationServiceRoleArn = organizationService.role.arn;
export const organizationServiceSgId = organizationService.serviceSg.id;
export const organizationServiceAlbSgId = organizationService.serviceAlbSg.id;
export const organizationServiceUrl = pulumi.interpolate`${organizationService.domain}`;
