import * as pulumi from '@pulumi/pulumi';
import * as dopplerProvider from '@pulumiverse/doppler';
import { BASE_DOMAIN, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { ConnectApiService } from './service';

const tags = {
  environment: stack,
  tech_lead: 'eric',
  project: 'connect-api',
};

const cluster = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});
const doppler = new dopplerProvider.Provider('connect-api-doppler', {
  dopplerToken: new pulumi.Config('doppler').requireSecret('dopplerToken'),
});
const service = new ConnectApiService('connect-api', {
  vpc: get_coparse_api_vpc(),
  tags,
  doppler,
  platform: { family: 'linux', architecture: 'amd64' },
  serviceContainerPort: 8080,
  healthCheckPath: '/health',
  ecsClusterArn: cluster.getOutput('cloudStorageClusterArn').apply((arn) => {
    if (typeof arn !== 'string') throw new Error('missing ECS cluster ARN');
    return arn;
  }),
  cloudStorageClusterName: cluster
    .getOutput('cloudStorageClusterName')
    .apply((name) => {
      if (typeof name !== 'string') throw new Error('missing ECS cluster name');
      return name;
    }),
});

export const connectKmsKeyId = service.kmsKey.keyId;
export const connectApiGatewayUrl = `https://${
  stack === 'prod' ? '' : `${stack}-`
}gateway.${BASE_DOMAIN}/connect`;
