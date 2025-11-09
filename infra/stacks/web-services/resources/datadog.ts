import * as aws from '@pulumi/aws';

export const DATADOG_API_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: 'datadog-api-key',
  })
  .apply((secret) => secret.secretString);

export const fargateLogRouterSidecarContainer = {
  essential: true,
  image: 'amazon/aws-for-fluent-bit:latest',
  name: 'log_router',
  firelensConfiguration: {
    type: 'fluentbit',
    options: {
      'config-file-type': 'file',
      'config-file-value': '/fluent-bit/configs/parse-json.conf',
      'enable-ecs-log-metadata': 'true',
    },
  },
  environment: [
    {
      name: 'ECS_FARGATE',
      value: 'true',
    },
    {
      name: 'DD_API_KEY',
      value: DATADOG_API_KEY,
    },
  ],
  memoryReservation: 50,
};

export const datadogAgentContainer = {
  name: 'datadog-agent',
  image: 'public.ecr.aws/datadog/agent:latest',
  environment: [
    {
      name: 'ECS_FARGATE',
      value: 'true',
    },
    {
      name: 'DD_SITE',
      value: 'us5.datadoghq.com',
    },
    {
      name: 'DD_API_KEY',
      value: DATADOG_API_KEY,
    },
  ],
  memoryReservation: 256,
};
