import * as pulumi from '@pulumi/pulumi';
import { stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { UnfurlService } from './unfurl-service';

const tags = {
  environment: stack,
  tech_lead: 'paul',
  project: 'unfurl-service',
};

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

const unfurlService = new UnfurlService(`unfurl-service-${stack}`, {
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
      name: 'ENVIRONMENT',
      value: stack,
    },
    // OpenTelemetry / Datadog tracing configuration
    {
      name: 'DD_SERVICE',
      value: 'unfurl-service',
    },
    {
      name: 'DD_ENV',
      value: stack,
    },
  ],
  isPrivate: false,
  tags,
});

export const unfurlServiceSgId = unfurlService.serviceSg.id;
export const unfurlServiceAlbSgId = unfurlService.serviceAlbSg.id;
export const unfurlServiceUrl = pulumi.interpolate`${unfurlService.domain}`;
