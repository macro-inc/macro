import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Queue } from '@resources';
import { config, stack } from '@shared';
import { get_coparse_api_vpc } from '@vpc';
import { ConvertService } from './service';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'convert',
};

const convertQueue = new Queue('convert-service', {
  tags,
  maxReceiveCount: 2,
});

export const convertQueueArn = convertQueue.queue.arn;
export const convertQueueName = convertQueue.queue.name;

export const coparse_api_vpc = get_coparse_api_vpc();

const INTERNAL_API_SECRET_KEY = config.require(`internal_api_key`);
const internalApiKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: INTERNAL_API_SECRET_KEY })
  .apply((secret) => secret.arn);

const DATABASE_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_secret_key`),
  })
  .apply((secret) => secret.secretString);

const secretKeyArns = [pulumi.interpolate`${internalApiKeyArn}`];

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const documentStorageBucketId: pulumi.Output<string> = cloudStorageStack
  .getOutput('documentStorageBucketId')
  .apply((id) => id as string);

const cloudStorageClusterArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterArn')
  .apply((arn) => arn as string);

const cloudStorageClusterName: pulumi.Output<string> = cloudStorageStack
  .getOutput('cloudStorageClusterName')
  .apply((arn) => arn as string);

const websocketConnectionStack = new pulumi.StackReference(
  'websocket-connection-stack',
  {
    name: `macro-inc/websocket-connection/${stack}`,
  }
);
export const jobUpdateHandlerLambdaArn: pulumi.Output<string> =
  websocketConnectionStack
    .getOutput('jobUpdateHandlerLambda')
    .apply((jobUpdateHandlerLambda) => jobUpdateHandlerLambda.arn as string);

export const jobUpdateHandlerLambdaName = jobUpdateHandlerLambdaArn.apply(
  (arn) => {
    const jobUpdateHandlerLambdaArnSplit = arn.split(':');
    return jobUpdateHandlerLambdaArnSplit[
      jobUpdateHandlerLambdaArnSplit.length - 1
    ];
  }
);

let containerEnvVars = [
  {
    name: 'RUST_LOG',
    value: `convert_service=${stack === 'prod' ? 'info' : 'debug'},tower_http=info`,
  },
  {
    name: 'ENVIRONMENT',
    value: stack,
  },
  {
    name: 'INTERNAL_API_SECRET_KEY',
    value: pulumi.interpolate`${INTERNAL_API_SECRET_KEY}`,
  },
  {
    name: 'CONVERT_QUEUE',
    value: pulumi.interpolate`${convertQueueName}`,
  },
  {
    name: 'LOK_PATH',
    value: '/app/lok/instdir/program',
  },
  {
    name: 'DOCUMENT_STORAGE_BUCKET',
    value: pulumi.interpolate`${documentStorageBucketId}`,
  },
  {
    name: 'DATABASE_URL',
    value: pulumi.interpolate`${DATABASE_URL}`,
  },
  {
    name: 'WEB_SOCKET_RESPONSE_LAMBDA',
    value: pulumi.interpolate`${jobUpdateHandlerLambdaName}`,
  },
];

const convertService = new ConvertService('convert-service', {
  convertQueueArn,
  jobUpdateHandlerLambdaArn,
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

export const convertServiceRoleArn = pulumi.interpolate`${convertService.role.arn}`;
export const convertServiceUrl = pulumi.interpolate`${convertService.domain}`;
