import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, getMacroApiToken, stack } from '@shared';
import { get_coparse_api_vpc } from '@vpc';
import { PropertiesService } from './properties-service';

const tags = {
  environment: stack,
  tech_lead: 'daniel',
  project: 'properties-service',
};

export const coparse_api_vpc = get_coparse_api_vpc();

// Properties tables have been migrated to macrodb
const DATABASE_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_secret_key`),
  })
  .apply((secret) => secret.secretString);

const macroDatabaseSecretArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_secret_key`),
  })
  .apply((secret) => secret.arn);

const JWT_SECRET_KEY = config.require(`jwt_secret_key`);
const jwtSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

const FUSIONAUTH_CLIENT_ID = config.require(`fusionauth_client_id`);
const FUSIONAUTH_ISSUER = config.require(`fusionauth_issuer`);

const INTERNAL_AUTH_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.get(`internal_auth_key`) ?? '',
  })
  .apply((secret) => secret.secretString);

const internalAuthKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.get(`internal_auth_key`) ?? '',
  })
  .apply((secret) => secret.arn);

const MACRO_API_TOKENS = getMacroApiToken();

const DOCUMENT_STORAGE_SERVICE_URL = `https://cloud-storage${stack === 'prod' ? '' : `-${stack}`}.macro.com`;

const COMMS_SERVICE_URL = `https://comms-service${stack === 'prod' ? '' : `-${stack}`}.macro.com`;

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const cloudStorageClusterArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterArn')
  .apply((arn) => arn as string);

const cloudStorageClusterName: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterName')
  .apply((arn) => arn as string);

const secretKeyArns = [
  pulumi.interpolate`${macroDatabaseSecretArn}`,
  pulumi.interpolate`${jwtSecretKeyArn}`,
  pulumi.interpolate`${internalAuthKeyArn}`,
  MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
];

const propertiesService = new PropertiesService(`properties-service-${stack}`, {
  ecsClusterArn: cloudStorageClusterArn,
  cloudStorageClusterName: cloudStorageClusterName,
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
      name: 'ENVIRONMENT',
      value: stack,
    },
    {
      name: 'RUST_LOG',
      value: `properties_service=${
        stack === 'prod' ? 'info' : 'trace'
      },tower_http=debug,document_storage_service_client=trace`,
    },

    {
      name: 'INTERNAL_API_SECRET_KEY',
      value: pulumi.interpolate`${INTERNAL_AUTH_KEY}`,
    },
    {
      name: 'COMMS_SERVICE_URL',
      value: COMMS_SERVICE_URL,
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
      name: 'MACRO_API_TOKEN_ISSUER',
      value: pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenIssuer}`,
    },
    {
      name: 'MACRO_API_TOKEN_PUBLIC_KEY',
      value: pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenPublicKey}`,
    },
    {
      name: 'DOCUMENT_STORAGE_SERVICE_URL',
      value: DOCUMENT_STORAGE_SERVICE_URL,
    },
    {
      name: 'DOCUMENT_STORAGE_SERVICE_AUTH_KEY',
      value: pulumi.interpolate`${INTERNAL_AUTH_KEY}`,
    },
  ],
  isPrivate: false,
  tags,
  secretKeyArns,
});

export const propertiesServiceUrl = pulumi.interpolate`${propertiesService.domain}`;
