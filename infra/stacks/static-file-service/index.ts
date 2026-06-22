import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, getMacroApiToken } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { SERVICE_NAME, StaticFileService } from './static-file-service';

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

const MACRO_API_TOKENS = getMacroApiToken();

const containerEnvVars = [
  {
    name: 'ENVIRONMENT',
    value: stack,
  },
  // OpenTelemetry / Datadog tracing configuration
  {
    name: 'DD_SERVICE',
    value: 'static-file-service',
  },
  {
    name: 'DD_ENV',
    value: stack,
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
