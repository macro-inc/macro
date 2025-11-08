import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Database } from '@resources';
import { config, stack } from '@shared';
import { get_coparse_api_vpc } from '@vpc';
import { Service } from './service';

// name of the "project". Usually the thing before "_service" or "_db_client"
const PROJECT = 'metering';
// name of who's in charge of this service
const TECH_LEAD = 'blake';

const SERVICE_NAME = `${PROJECT}_service`;
const DB_CLIENT_NAME = `${PROJECT}_db_client`;
const DATABASE_PASSWORD_CONFIG_KEY = `db-password-secret-key`;
const RDS_INSTANCE_NAME = `${PROJECT}-db`;
const DATABASE_NAME = PROJECT;

const tags = {
  environment: stack,
  tech_lead: TECH_LEAD,
  project: PROJECT,
};

export const coparse_api_vpc = get_coparse_api_vpc();

const password = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(DATABASE_PASSWORD_CONFIG_KEY),
  })
  .apply((secret) => secret.secretString);

const db = new Database(RDS_INSTANCE_NAME, {
  publiclyAccessible: false,
  tags,
  vpc: coparse_api_vpc,
  dbArgs: {
    dbName: DATABASE_NAME,
    instanceClass: stack === 'prod' ? 'db.t4g.large' : 'db.t4g.micro',
    password,
    allocatedStorage: 25,
  },
});

export const databaseEndpoint = db.endpoint;

const DATABASE_URL = pulumi.all([databaseEndpoint, password]).apply(
  // eslint-disable-next-line @typescript-eslint/no-shadow
  ([endpoint, password]) =>
    `postgresql://macrouser:${password}@${endpoint}/${DATABASE_NAME}`
);

const INTERNAL_API_SECRET_KEY = config.require(`internal_api_key`);
const INTERNAL_AUTH_KEY: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: pulumi.interpolate`${INTERNAL_API_SECRET_KEY}`,
  })
  .apply((secret) => secret.secretString);

let containerEnvVars = [
  {
    name: 'RUST_LOG',
    value: `${SERVICE_NAME}=${stack === 'prod' ? 'info' : 'debug'},${DB_CLIENT_NAME}=${stack === 'prod' ? 'info' : 'debug'},tower_http=info`,
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
    name: 'INTERNAL_API_SECRET_KEY',
    value: pulumi.interpolate`${INTERNAL_AUTH_KEY}`,
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

const service = new Service(SERVICE_NAME, {
  vpc: coparse_api_vpc,
  tags,
  containerEnvVars,
  platform: { family: 'linux', architecture: 'amd64' },
  serviceContainerPort: 8080,
  healthCheckPath: '/health',
  isPrivate: stack === 'prod',
  ecsClusterArn: cloudStorageClusterArn,
  cloudStorageClusterName,
});

export const meteringServiceUrl = pulumi.interpolate`${service.domain}`;
