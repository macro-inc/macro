import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Redis } from '../../packages/resources';
import { config, getMacroApiToken, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
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

const JWT_SECRET_KEY = config.require(`jwt_secret_key`);
const jwtSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
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
    // OpenTelemetry / Datadog tracing configuration
    {
      name: 'DD_SERVICE',
      value: 'connection-gateway',
    },
    {
      name: 'DD_ENV',
      value: stack,
    },
  ],
  isPrivate: false,
  tags,
});

export const connectionGatewaySgId = connectionGateway.serviceSg.id;
export const connectionGatewayAlbSgId = connectionGateway.serviceAlbSg.id;
export const connectionGatewayUrl = pulumi.interpolate`${connectionGateway.domain}`;
export const connectionGatewayRedisUrl = pulumi.interpolate`${connectionGatewayRedis.endpoint}`;
export const connectionGatewayTableName = connectionGatewayTable.table.name;
export const connectionGatewayTablePolicyArn =
  connectionGatewayTable.policy.arn;
