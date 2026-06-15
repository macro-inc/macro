import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Queue } from '../../packages/resources';
import { config, getMacroApiToken, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { ContactsService } from './service';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'contacts',
};

const contactsQueue = new Queue('contacts', {
  tags,
});

export const contactsQueueArn = contactsQueue.queue.arn;
export const contactsQueueName = contactsQueue.queue.name;

export const coparse_api_vpc = get_coparse_api_vpc();

const JWT_SECRET_KEY = config.require(`jwt_secret_key`);
const jwtSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

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
    name: 'ENVIRONMENT',
    value: stack,
  },
  { name: 'DOPPLER_PROJECT', value: 'contacts_service' },
  // OpenTelemetry / Datadog tracing configuration
  {
    name: 'DD_SERVICE',
    value: 'contacts-service',
  },
  {
    name: 'DD_ENV',
    value: stack,
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
