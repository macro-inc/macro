import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Queue } from '../../packages/resources';
import { config, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
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

const secretKeyArns = [pulumi.interpolate`${internalApiKeyArn}`];

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

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
    name: 'ENVIRONMENT',
    value: stack,
  },
  // OpenTelemetry / Datadog tracing configuration
  {
    name: 'DD_SERVICE',
    value: 'convert-service',
  },
  {
    name: 'DD_ENV',
    value: stack,
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
