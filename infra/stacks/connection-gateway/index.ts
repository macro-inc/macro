import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Redis } from '@resources';
import { config, getMacroApiToken, stack } from '@shared';
import { get_coparse_api_vpc } from '@vpc';
import { ConnectionGateway } from './connection_gateway';
import { getConnectionGatewayTable } from './connection_table';

const tags = {
  environment: stack,
  tech_lead: 'teo',
  project: 'connection-gateway',
};

export const connectionGatewayTable: {
  table: aws.dynamodb.Table;
  policy: aws.iam.Policy;
} = getConnectionGatewayTable();

const LEGACY_JWT_SECRET = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.get(`legacy_jwt_secret_key`) ?? '',
  })
  .apply((secret) => secret.secretString);

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

const connectionGatewayRedis = new Redis('connection-gateway-redis', {
  vpc: coparse_api_vpc,
  tags,
  redisArgs: {
    nodeType: 'cache.t3.micro',
    port: 6379,
    engineVersion: '7.1',
  },
});

const MACRO_API_TOKENS = getMacroApiToken();

const MACRO_DB_URL = config.require(`macro_db_secret_key`);
const macroDbUrlArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: MACRO_DB_URL })
  .apply((secret) => secret.arn);

const connectionGateway = new ConnectionGateway(`connection-gateway-${stack}`, {
  ecsClusterArn: cloudStorageClusterArn,
  cloudStorageClusterName: cloudStorageClusterName,
  vpc: coparse_api_vpc,
  platform: {
    family: 'linux',
    architecture: 'amd64',
  },
  secretKeyArns: [
    jwtSecretKeyArn,
    MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
    macroDbUrlArn,
  ],
  serviceContainerPort: 8080,
  healthCheckPath: '/health',
  connectionTablePolicy: connectionGatewayTable.policy,
  containerEnvVars: [
    {
      name: 'ENVIRONMENT',
      value: stack,
    },
    {
      name: 'RUST_LOG',
      value: `connection_gateway=${
        stack === 'prod' ? 'info' : 'trace'
      },tower_http=debug,frecency=warn`,
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
      name: 'CONNECTION_GATEWAY_TABLE',
      value: pulumi.interpolate`${connectionGatewayTable.table.name}`,
    },
    {
      name: 'REDIS_HOST',
      value: pulumi.interpolate`redis://${connectionGatewayRedis.endpoint}`,
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
      value: pulumi.interpolate`${MACRO_DB_URL}`,
    },
  ],
  isPrivate: false,
  tags,
});

export const connectionGatewaySgId = connectionGateway.serviceSg.id;
export const connectionGatewayAlbSgId = connectionGateway.serviceAlbSg.id;
export const connectionGatewayUrl = pulumi.interpolate`${connectionGateway.domain}`;
export const connectionGatewayRedisUrl = pulumi.interpolate`${connectionGatewayRedis.endpoint}`;
