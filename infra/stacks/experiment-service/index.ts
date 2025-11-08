import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, getMacroApiToken, stack } from '@shared';
import { get_coparse_api_vpc } from '@vpc';
import { ExperimentService } from './service';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'experiments',
};

export const coparse_api_vpc = get_coparse_api_vpc();

const DATABASE_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_secret_key`),
  })
  .apply((secret) => secret.secretString);
const JWT_SECRET_KEY = config.require(`jwt_secret_key`);
const jwtSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

const fusionauthClientIdSecretKey = config.require(`fusionauth_client_id`);

const AUDIENCE = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: fusionauthClientIdSecretKey,
  })
  .apply((secret) => secret.secretString);
const ISSUER = config.require(`fusionauth_issuer`);
const INTERNAL_API_SECRET_KEY = config.require(`internal_api_key`);
const internalApiKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: INTERNAL_API_SECRET_KEY })
  .apply((secret) => secret.arn);

const MACRO_API_TOKENS = getMacroApiToken();

const secretKeyArns = [
  pulumi.interpolate`${jwtSecretKeyArn}`,
  pulumi.interpolate`${internalApiKeyArn}`,
  MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
];

const logLevel = stack === 'prod' ? 'info' : 'debug';

let containerEnvVars = [
  {
    name: 'RUST_LOG',
    value: `experiment_service=${logLevel},macro_middleware=${logLevel},macro_db_client=${logLevel},tower_http=info`,
  },
  {
    name: 'ENVIRONMENT',
    value: stack,
  },
  {
    name: 'DATABASE_URL',
    value: pulumi.interpolate`${DATABASE_URL}`,
  },
  {
    name: 'JWT_SECRET_KEY',
    value: pulumi.interpolate`${JWT_SECRET_KEY}`,
  },
  {
    name: 'AUDIENCE',
    value: pulumi.interpolate`${AUDIENCE}`,
  },
  {
    name: 'ISSUER',
    value: pulumi.interpolate`${ISSUER}`,
  },
  {
    name: 'INTERNAL_API_SECRET_KEY',
    value: pulumi.interpolate`${INTERNAL_API_SECRET_KEY}`,
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

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const cloudStorageClusterArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterArn')
  .apply((arn) => arn as string);

const cloudStorageClusterName: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterName')
  .apply((arn) => arn as string);

const experimentService = new ExperimentService('experiment-service', {
  vpc: coparse_api_vpc,
  tags,
  containerEnvVars,
  platform: { family: 'linux', architecture: 'amd64' },
  serviceContainerPort: 8080,
  healthCheckPath: '/health',
  isPrivate: false,
  ecsClusterArn: cloudStorageClusterArn,
  cloudStorageClusterName,
  secretKeyArns,
});

export const experimentServiceUrl = pulumi.interpolate`${experimentService.domain}`;
