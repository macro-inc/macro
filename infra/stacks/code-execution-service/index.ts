import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import * as dopplerProvider from '@pulumiverse/doppler';
import { EcrImage } from '../../packages/service';
import { config, DopplerEcsEnvironment, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';

const name = 'code-execution-service';
const port = 8112;
const tags = {
  environment: stack,
  env: stack,
  project: name,
  service: name,
  tech_lead: 'wolf',
};
const vpc = get_coparse_api_vpc();
const cluster = new pulumi.StackReference(`${name}-cluster`, {
  name: `macro-inc/document-storage/${stack}`,
});
const harness = new pulumi.StackReference(`${name}-caller`, {
  name: `macro-inc/agent-harness-service/${stack}`,
});
const securityGroup = new aws.ec2.SecurityGroup(`${name}-${stack}`, {
  vpcId: vpc.vpcId,
  description: 'Private runner; only the agent backend can submit executions',
  ingress: [],
  egress: [],
  tags,
});
new aws.vpc.SecurityGroupIngressRule(`${name}-caller-${stack}`, {
  securityGroupId: securityGroup.id,
  referencedSecurityGroupId: harness.requireOutput(
    'agentHarnessServiceSecurityGroupId'
  ) as pulumi.Output<string>,
  ipProtocol: 'tcp',
  fromPort: port,
  toPort: port,
});
// ECS image pulls, secret injection, and log shipping need HTTPS. Deno itself
// has no network permission and the task role has no application permissions.
new aws.vpc.SecurityGroupEgressRule(`${name}-https-${stack}`, {
  securityGroupId: securityGroup.id,
  ipProtocol: 'tcp',
  fromPort: 443,
  toPort: 443,
  cidrIpv4: '0.0.0.0/0',
});
const namespace = new aws.servicediscovery.PrivateDnsNamespace(
  `${name}-${stack}`,
  {
    name: `code-execution-${stack}.internal`,
    vpc: vpc.vpcId,
    tags,
  }
);
const discovery = new aws.servicediscovery.Service(`${name}-${stack}`, {
  name: 'runner',
  dnsConfig: {
    namespaceId: namespace.id,
    routingPolicy: 'MULTIVALUE',
    dnsRecords: [{ type: 'A', ttl: 10 }],
  },
  healthCheckCustomConfig: { failureThreshold: 1 },
  tags,
});
const image = new EcrImage(`${name}-${stack}`, {
  repositoryId: `${name}-ecr-${stack}`,
  repositoryName: `${name}-${stack}`,
  imageId: `${name}-image-${stack}`,
  imagePath: '../../..',
  dockerfile: 'docker/Dockerfile.code_execution',
  platform: { family: 'linux', architecture: 'amd64' },
  tags,
});
const deploymentConfig: Record<string, pulumi.Input<string>> = {
  ENVIRONMENT: stack,
  PORT: String(port),
  DENO_BINARY: '/usr/local/bin/deno',
  DENO_SCRATCH_DIRECTORY: '/scratch',
  DENO_HEAP_MB: '128',
  MAX_RUNNING: '4',
  MAX_QUEUED: '16',
  MAX_DURATION_MS: '30000',
  CODE_EXECUTION_TOKEN: config.requireSecret('serviceToken'),
};
const configSecrets = Object.entries(deploymentConfig).map(
  ([key, value]) =>
    new dopplerProvider.Secret(`${name}-${key}-${stack}`, {
      project: name,
      config: stack === 'prod' ? 'prd' : 'dev',
      name: key,
      value,
    })
);
const doppler = new DopplerEcsEnvironment(name, { tags });
const role = new aws.iam.Role(`${name}-${stack}`, {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: 'ecs-tasks.amazonaws.com',
  }),
  tags,
});
const logs = new aws.cloudwatch.LogGroup(`${name}-${stack}`, {
  retentionInDays: 14,
  tags,
});
const service = new awsx.ecs.FargateService(
  `${name}-${stack}`,
  {
    cluster: cluster.requireOutput(
      'cloudStorageClusterArn'
    ) as pulumi.Output<string>,
    desiredCount: 1,
    // Executions are ephemeral and connection-owned. Do not replay after a restart.
    deploymentMinimumHealthyPercent: 0,
    deploymentMaximumPercent: 100,
    deploymentCircuitBreaker: { enable: true, rollback: true },
    networkConfiguration: {
      subnets: vpc.privateSubnetIds,
      securityGroups: [securityGroup.id],
      assignPublicIp: false,
    },
    serviceRegistries: { registryArn: discovery.arn },
    taskDefinitionArgs: {
      taskRole: { roleArn: role.arn },
      executionRole: { roleArn: doppler.executionRole.arn },
      runtimePlatform: {
        operatingSystemFamily: 'LINUX',
        cpuArchitecture: 'X86_64',
      },
      volumes: [{ name: 'scratch' }],
      containers: {
        service: {
          name: 'service',
          image: image.image.imageUri,
          cpu: 1024,
          memory: 2048,
          essential: true,
          user: '10001:10001',
          readonlyRootFilesystem: true,
          linuxParameters: { capabilities: { drop: ['ALL'] } },
          ulimits: [
            { name: 'nofile', softLimit: 1024, hardLimit: 1024 },
            { name: 'nproc', softLimit: 256, hardLimit: 256 },
          ],
          mountPoints: [
            {
              sourceVolume: 'scratch',
              containerPath: '/scratch',
              readOnly: false,
            },
          ],
          stopTimeout: 15,
          secrets: doppler.containerSecrets,
          environment: [
            { name: 'ENVIRONMENT', value: stack },
            { name: 'DD_SERVICE', value: name },
            { name: 'DD_ENV', value: stack },
          ],
          portMappings: [
            { containerPort: port, hostPort: port, protocol: 'tcp' },
          ],
          healthCheck: {
            command: [
              'CMD-SHELL',
              `curl -fsS http://127.0.0.1:${port}/health || exit 1`,
            ],
            interval: 15,
            timeout: 3,
            retries: 3,
            startPeriod: 20,
          },
          logConfiguration: {
            logDriver: 'awslogs',
            options: {
              'awslogs-group': logs.name,
              'awslogs-region': aws.getRegionOutput().name,
              'awslogs-stream-prefix': 'runner',
            },
          },
        },
      },
    },
    tags,
  },
  { dependsOn: configSecrets }
);

export const runnerUrl = pulumi.interpolate`ws://runner.${namespace.name}:${port}/v1/execute`;
// The runner stack owns both ends of this private credential. Keeping the
// caller settings here avoids a circular stack reference with its security group.
for (const [key, value] of Object.entries({
  CODE_EXECUTION_URL: runnerUrl,
  CODE_EXECUTION_TOKEN: config.requireSecret('serviceToken'),
})) {
  new dopplerProvider.Secret(
    `${name}-caller-${key}-${stack}`,
    {
      project: 'agent-harness-service',
      config: stack === 'prod' ? 'prd' : 'dev',
      name: key,
      value,
    },
    { dependsOn: [service] }
  );
}
export const runnerServiceArn = service.service.id;
export const runnerSecurityGroupId = securityGroup.id;
