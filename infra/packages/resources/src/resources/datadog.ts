import * as aws from '@pulumi/aws';
import type { ecs } from '@pulumi/awsx/types/input';
import { SoftwareCatalog } from '@pulumi/datadog';
import {
  ComponentResource,
  type ComponentResourceOptions,
} from '@pulumi/pulumi';
import { stack } from '../../../shared';

const DATADOG_API_KEY_SECRET_KEY = 'datadog-api-key';

export const DATADOG_API_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: DATADOG_API_KEY_SECRET_KEY,
  })
  .apply((secret) => secret.secretString);

interface DatadogServiceEntityArgs {
  serviceName: string;
  owner: string;
  githubUrl: string;
  githubPath: string;
  displayName?: string;
}

export class DatadogServiceEntity extends ComponentResource {
  public softwareCatalog: SoftwareCatalog;

  constructor(
    name: string,
    args: DatadogServiceEntityArgs,
    opts?: ComponentResourceOptions
  ) {
    super('datadog:serviceEntity', name, args, opts);

    const displayName = args.displayName ?? args.serviceName;

    this.softwareCatalog = new SoftwareCatalog(
      `${name}-software-catalog`,
      {
        entity: `
          apiVersion: v3
          kind: service
          metadata:
            name: ${args.serviceName}
            displayName: ${displayName}
            owner: ${args.owner}
            tags:
              - kind:service
            links:
              - name: ${displayName} repository
                provider: github
                url: ${args.githubUrl}
                type: repo
          spec:
            languages:
              - rust
            dependsOn:
              - service:document-storage
          datadog:       
            codeLocations:
              - repositoryURL: ${args.githubUrl}.git
                paths:
                  - ${args.githubPath}
        `,
      },
      { parent: this }
    );
  }
}

export const fargateLogRouterSidecarContainer = {
  essential: true,
  image: 'amazon/aws-for-fluent-bit:latest',
  stopTimeout: 10, // 10 seconds to force kill the task
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
    {
      name: 'DD_ENV',
      value: stack,
    },
  ],
  memoryReservation: 50,
} satisfies ecs.TaskDefinitionContainerDefinitionArgs;

export const datadogAgentContainer = {
  name: 'datadog-agent',
  image: 'public.ecr.aws/datadog/agent:latest',
  stopTimeout: 10, // 10 seconds to force kill the task
  environment: [
    {
      name: 'ECS_FARGATE',
      value: 'true',
    },
    {
      name: 'DD_ENV',
      value: stack,
    },
    {
      name: 'DD_SITE',
      value: 'us5.datadoghq.com',
    },
    {
      name: 'DD_API_KEY',
      value: DATADOG_API_KEY,
    },
    // APM/Tracing configuration
    {
      name: 'DD_APM_ENABLED',
      value: 'true',
    },
    {
      name: 'DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_GRPC_ENDPOINT',
      value: '0.0.0.0:4317',
    },
    // Sampling configuration to prevent excessive disk writes
    // Sample 10% of traces in prod, 100% in dev for debugging
    {
      name: 'DD_APM_SAMPLE_RATE',
      value: stack === 'prod' ? '0.1' : '1.0',
    },
    // Limit max traces per second to prevent runaway costs
    {
      name: 'DD_APM_MAX_TPS',
      value: '100',
    },
    // Disable disk buffering to prevent the 1GB/s disk write issue
    {
      name: 'DD_APM_RECEIVER_SOCKET',
      value: '',
    },
  ],
  portMappings: [
    {
      containerPort: 4317,
    },
  ],
  memoryReservation: 256,
} satisfies ecs.TaskDefinitionContainerDefinitionArgs;
