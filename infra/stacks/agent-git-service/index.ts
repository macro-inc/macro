import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import {
  BASE_DOMAIN,
  config,
  getMacroApiToken,
  stack,
} from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { AgentGitService } from './service';

const tags = {
  environment: stack,
  tech_lead: 'wolf',
  project: 'agent-git-service',
};

export const coparse_api_vpc = get_coparse_api_vpc();

const JWT_SECRET_KEY = config.require(`jwt_secret_key`);

const secretArn = (secretId: string): pulumi.Output<string> =>
  aws.secretsmanager
    .getSecretVersionOutput({ secretId })
    .apply((secret) => secret.arn);

const MACRO_API_TOKENS = getMacroApiToken();

// JwtValidationArgs::new_with_secret_manager reads the FusionAuth JWT secret
// and the Macro API token public key from Secrets Manager at boot.
const secretKeyArns = [
  secretArn(JWT_SECRET_KEY),
  MACRO_API_TOKENS.macroApiTokenPublicKeyArn,
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

const containerEnvVars = [
  { name: 'ENVIRONMENT', value: stack },
  { name: 'DOPPLER_PROJECT', value: 'agent-git-service' },
  { name: 'DD_SERVICE', value: 'agent-git-service' },
  { name: 'DD_ENV', value: stack },
];

const agentGitService = new AgentGitService('agent-git-service', {
  vpc: coparse_api_vpc,
  tags,
  containerEnvVars,
  platform: { family: 'linux', architecture: 'amd64' },
  serviceContainerPort: 8080,
  healthCheckPath: '/health',
  ecsClusterArn: cloudStorageClusterArn,
  cloudStorageClusterName,
  secretKeyArns,
});

export const agentGitServiceUrl = agentGitService.domain;
export const agentGitRepoFileSystemId = agentGitService.fileSystem.id;

export const agentGitServiceGatewayUrl = `https://${
  stack === 'prod' ? '' : `${stack}-`
}gateway.${BASE_DOMAIN}/agent-git`;
