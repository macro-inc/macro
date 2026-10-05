import * as pulumi from '@pulumi/pulumi';
import { getServiceUrl, ServiceUrl, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { LexicalService } from './lexical-service';

const tags = {
  environment: stack,
  tech_lead: 'wolf',
  project: 'lexical-service',
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

const lexicalService = new LexicalService(`lexical-service-${stack}`, {
  ecsClusterArn: cloudStorageClusterArn,
  cloudStorageClusterName: cloudStorageClusterName,
  vpc: coparse_api_vpc,
  platform: {
    family: 'linux',
    architecture: 'amd64',
  },
  serviceContainerPort: 8096,
  healthCheckPath: '/health',
  containerEnvVars: [
    { name: 'PORT', value: '8096' },
    {
      name: 'SYNC_SERVICE_URL',
      value: getServiceUrl(ServiceUrl.SYNC_SERVICE_URL),
    },
  ],
  tags,
});

export const lexicalServiceSgId = lexicalService.serviceSg.id;
export const lexicalServiceUrl = getServiceUrl(ServiceUrl.LEXICAL_GATEWAY_URL);
