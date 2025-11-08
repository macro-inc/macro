import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Database, Queue } from '@resources';
import { config, getMacroApiToken, stack } from '@shared';
import { get_coparse_api_vpc } from '@vpc';
import { ContactsService } from './service';

const tags = {
  environment: stack,
  tech_lead: 'paul',
  project: 'contacts',
};

const contactsQueue = new Queue('contacts', {
  tags,
});

export const contactsQueueArn = contactsQueue.queue.arn;
export const contactsQueueName = contactsQueue.queue.name;

export const coparse_api_vpc = get_coparse_api_vpc();

const password = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('db-password-secret-key'),
  })
  .apply((secret) => secret.secretString);

const contactsDb = new Database('contacts-db', {
  publiclyAccessible: stack !== 'prod', // Lock down prod db only
  tags,
  vpc: coparse_api_vpc,
  dbArgs: {
    dbName: 'contacts',
    instanceClass: stack === 'prod' ? 'db.t4g.large' : 'db.t4g.micro',
    password,
    allocatedStorage: 25,
  },
});

export const contactsDatabaseEndpoint = contactsDb.endpoint;

const DATABASE_URL = pulumi.all([contactsDatabaseEndpoint, password]).apply(
  // eslint-disable-next-line @typescript-eslint/no-shadow
  ([endpoint, password]) =>
    `postgresql://macrouser:${password}@${endpoint}/contacts`
);

const JWT_SECRET_KEY = config.require(`jwt_secret_key`);
const jwtSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

const AUDIENCE = config.require(`fusionauth_client_id`);
const ISSUER = config.require(`fusionauth_issuer`);
const INTERNAL_API_SECRET_KEY = config.require(`internal_api_key`);
const internalApiKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: INTERNAL_API_SECRET_KEY })
  .apply((secret) => secret.arn);

let MACRO_API_TOKENS = getMacroApiToken();

const secretKeyArns = [
  pulumi.interpolate`${jwtSecretKeyArn}`,
  pulumi.interpolate`${internalApiKeyArn}`,
  MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
];

let containerEnvVars = [
  {
    name: 'RUST_LOG',
    value: `contacts_service=${stack === 'prod' ? 'info' : 'debug'},contacts_db_client=${stack === 'prod' ? 'info' : 'debug'},tower_http=info`,
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
    name: 'CONTACTS_QUEUE',
    value: pulumi.interpolate`${contactsQueueName}`,
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

const contactsService = new ContactsService('contacts-service', {
  contactsQueueArn,
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

export const contactsServiceUrl = pulumi.interpolate`${contactsService.domain}`;
