import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, getMacroApiToken, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { ImageProxyService } from './image-proxy-service';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'image-proxy-service',
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

// JWT secrets
const JWT_SECRET_KEY = config.require(`jwt_secret_key`);
const jwtSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
  .getSecretVersionOutput({ secretId: JWT_SECRET_KEY })
  .apply((secret) => secret.arn);

const fusionauthClientIdSecretKey = config.require(`fusionauth_client_id`);
const FUSIONAUTH_CLIENT_ID = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: fusionauthClientIdSecretKey,
  })
  .apply((secret) => secret.secretString);
const FUSIONAUTH_ISSUER = config.require(`fusionauth_issuer`);

const MACRO_API_TOKENS = getMacroApiToken();

const secretKeyArns = [
  pulumi.interpolate`${jwtSecretKeyArn}`,
  pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenPublicKeyArn}`,
];

const imageProxyService = new ImageProxyService(
  `image-proxy-service-${stack}`,
  {
    ecsClusterArn: cloudStorageClusterArn,
    cloudStorageClusterName: cloudStorageClusterName,
    vpc: coparse_api_vpc,
    platform: {
      family: 'linux',
      architecture: 'amd64',
    },
    serviceContainerPort: 8080,
    healthCheckPath: '/health',
    secretKeyArns,
    containerEnvVars: [
      {
        name: 'ENVIRONMENT',
        value: stack,
      },
      {
        name: 'RUST_LOG',
        value: `image_proxy_service=${
          stack === 'prod' ? 'debug' : 'trace'
        },tower_http=debug`,
      },
      {
        name: 'JWT_SECRET_KEY',
        value: pulumi.interpolate`${JWT_SECRET_KEY}`,
      },
      {
        name: 'AUDIENCE',
        value: pulumi.interpolate`${FUSIONAUTH_CLIENT_ID}`,
      },
      {
        name: 'ISSUER',
        value: pulumi.interpolate`${FUSIONAUTH_ISSUER}`,
      },
      {
        name: 'MACRO_API_TOKEN_ISSUER',
        value: pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenIssuer}`,
      },
      {
        name: 'MACRO_API_TOKEN_PUBLIC_KEY',
        value: pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenPublicKey}`,
      },
      // OpenTelemetry / Datadog tracing configuration
      {
        name: 'DD_SERVICE',
        value: 'image-proxy-service',
      },
      {
        name: 'DD_ENV',
        value: stack,
      },
    ],
    isPrivate: false,
    tags,
  }
);

export const imageProxyServiceSgId = imageProxyService.serviceSg.id;
export const imageProxyServiceAlbSgId = imageProxyService.serviceAlbSg.id;
export const imageProxyServiceUrl = pulumi.interpolate`${imageProxyService.domain}`;
