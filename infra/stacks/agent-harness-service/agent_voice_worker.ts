import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import { DEFAULT_CONTINUE_BEFORE_STEADY_STATE } from '../../packages/resources';
import { stack } from '../../packages/shared';

type Args = {
  clusterArn: pulumi.Input<string>;
  subnetIds: pulumi.Input<pulumi.Input<string>[]>;
  securityGroupId: pulumi.Input<string>;
  executionRoleArn: pulumi.Input<string>;
  secretsArn: pulumi.Input<string>;
  tags: Record<string, string>;
};

/** Deploy speech workers with the harness, with no access to Macro's task tools. */
export function createAgentVoiceWorker(
  args: Args,
  parent: pulumi.Resource
): awsx.ecs.FargateService {
  const name = `agent-voice-${stack}`;
  const tags = { ...args.tags, service: 'agent-voice' };
  // This Python image is independent of the Rust prebuilt-binary image path.
  const repository = new awsx.ecr.Repository(
    `${name}-ecr`,
    { name, tags },
    { parent }
  );
  const image = new awsx.ecr.Image(
    `${name}-image`,
    {
      repositoryUrl: repository.url,
      context: '../../../services/agent_voice',
      dockerfile: '../../../services/agent_voice/Dockerfile',
      platform: 'linux/amd64',
    },
    { parent }
  );
  const taskRole = new aws.iam.Role(
    `${name}-task-role`,
    {
      assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
        Service: 'ecs-tasks.amazonaws.com',
      }),
      tags,
    },
    { parent }
  );
  const logs = new aws.cloudwatch.LogGroup(
    `${name}-logs`,
    { name: `/ecs/${name}`, retentionInDays: 30, tags },
    { parent }
  );
  const secretKeys = {
    LIVEKIT_URL: 'LIVEKIT_SERVER_URL',
    LIVEKIT_API_KEY: 'LIVEKIT_API_KEY',
    LIVEKIT_API_SECRET: 'LIVEKIT_API_SECRET',
    OPENAI_API_KEY: 'OPENAI_API_KEY',
  };
  return new awsx.ecs.FargateService(
    name,
    {
      cluster: args.clusterArn,
      desiredCount: 2,
      networkConfiguration: {
        subnets: args.subnetIds,
        securityGroups: [args.securityGroupId],
      },
      deploymentCircuitBreaker: { enable: true, rollback: true },
      deploymentMinimumHealthyPercent: 100,
      deploymentMaximumPercent: 200,
      continueBeforeSteadyState: DEFAULT_CONTINUE_BEFORE_STEADY_STATE,
      taskDefinitionArgs: {
        cpu: '1024',
        memory: '2048',
        taskRole: { roleArn: taskRole.arn },
        executionRole: { roleArn: args.executionRoleArn },
        runtimePlatform: {
          operatingSystemFamily: 'LINUX',
          cpuArchitecture: 'X86_64',
        },
        containers: {
          voice: {
            name: 'macro-agent-voice',
            image: image.imageUri,
            essential: true,
            stopTimeout: 120,
            // Extract only the four voice credentials, never APP_SECRETS_JSON.
            secrets: Object.entries(secretKeys).map(([name, key]) => ({
              name,
              valueFrom: pulumi.interpolate`${args.secretsArn}:${key}::`,
            })),
            healthCheck: {
              command: [
                'CMD',
                'python',
                '-c',
                "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8081/', timeout=5).read()",
              ],
              interval: 30,
              timeout: 10,
              retries: 3,
              startPeriod: 60,
            },
            logConfiguration: {
              logDriver: 'awslogs',
              options: {
                'awslogs-group': logs.name,
                'awslogs-region': aws.getRegionOutput().name,
                'awslogs-stream-prefix': 'voice',
              },
            },
          },
        },
      },
      tags,
    },
    { parent }
  );
}
