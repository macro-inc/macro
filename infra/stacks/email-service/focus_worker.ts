import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import {
  DATADOG_API_KEY,
  DEFAULT_CONTINUE_BEFORE_STEADY_STATE,
  EcsDeploymentFailureAlarm,
  withTelemetry,
} from '../../packages/resources';
import { EcrImage } from '../../packages/service';
import { type DopplerEcsEnvironment, stack } from '../../packages/shared';

const BASE_NAME = 'email-focus-worker';
const REPO_ROOT = '../../..';

type Args = {
  role: aws.iam.Role;
  ecsClusterArn: pulumi.Output<string> | string;
  vpc: {
    vpcId: pulumi.Output<string> | string;
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  platform: { family: string; architecture: 'amd64' | 'arm64' };
  containerEnvVars: { name: string; value: pulumi.Output<string> | string }[];
  tags: { [key: string]: string };
  dopplerEcsEnvironment: DopplerEcsEnvironment;
};

/**
 * Classifies signal threads for the Focus view. One task: it consumes the
 * email event topic and runs an hourly sweep, and every write it makes is
 * idempotent, so it needs no scaling or coordination.
 */
export class EmailFocusWorker extends pulumi.ComponentResource {
  public ecr: awsx.ecr.Repository;
  public service: awsx.ecs.FargateService;

  constructor(
    name: string,
    {
      role,
      ecsClusterArn,
      vpc,
      platform,
      containerEnvVars,
      dopplerEcsEnvironment,
      tags,
    }: Args,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:EmailFocusWorker', name, {}, opts);

    const image = new EcrImage(
      `${BASE_NAME}-ecr-image-${stack}`,
      {
        repositoryId: `${BASE_NAME}-ecr-${stack}`,
        repositoryName: `${BASE_NAME}-${stack}`,
        imageId: `${BASE_NAME}-image-${stack}`,
        imagePath: REPO_ROOT,
        dockerfile: 'docker/Dockerfile',
        platform,
        tags,
        buildArgs: {
          SERVICE_NAME: 'email_focus_worker',
        },
      },
      { parent: this }
    );
    this.ecr = image.ecr;

    // The worker only calls out: Postgres, Kafka and the classifier API.
    const serviceSg = new aws.ec2.SecurityGroup(
      `${BASE_NAME}-sg-${stack}`,
      {
        name: `${BASE_NAME}-sg-${stack}`,
        vpcId: vpc.vpcId,
        description: `${BASE_NAME} security group that is attached directly to the service`,
        tags,
      },
      { parent: this }
    );
    new aws.vpc.SecurityGroupEgressRule(
      `${BASE_NAME}-all-out`,
      {
        securityGroupId: serviceSg.id,
        description: 'Allow all outbound',
        cidrIpv4: '0.0.0.0/0',
        ipProtocol: '-1',
        tags,
      },
      { parent: this }
    );

    this.service = new awsx.ecs.FargateService(
      BASE_NAME,
      {
        tags,
        cluster: ecsClusterArn,
        networkConfiguration: {
          subnets: vpc.privateSubnetIds,
          securityGroups: [serviceSg.id],
        },
        continueBeforeSteadyState: DEFAULT_CONTINUE_BEFORE_STEADY_STATE,
        deploymentCircuitBreaker: {
          enable: true,
          rollback: true,
        },
        taskDefinitionArgs: {
          taskRole: {
            roleArn: role.arn,
          },
          executionRole: {
            roleArn: dopplerEcsEnvironment.executionRole.arn,
          },
          containers: withTelemetry(BASE_NAME, {
            service: {
              name: BASE_NAME,
              image: image.image.imageUri,
              stopTimeout: 10, // 10 seconds to force kill the task
              cpu: 512,
              memory: 718, // 1024 - 256 for datadog - 50 for log_router
              // Trace as its own service so worker errors stay out of email-service's APM.
              environment: [
                ...containerEnvVars.filter((env) => env.name !== 'DD_SERVICE'),
                { name: 'DD_SERVICE', value: BASE_NAME },
              ],
              secrets: [...dopplerEcsEnvironment.containerSecrets],
              logConfiguration: {
                logDriver: 'awsfirelens',
                options: {
                  Name: 'datadog',
                  Host: 'http-intake.logs.us5.datadoghq.com',
                  apikey: DATADOG_API_KEY,
                  dd_service: `${BASE_NAME}-${stack}`,
                  dd_source: 'fargate',
                  dd_tags: `project:cloudstorage, env:${stack}`,
                  provider: 'ecs',
                },
              },
            },
          }),
          runtimePlatform: {
            operatingSystemFamily: `${platform.family.toUpperCase()}`,
            cpuArchitecture: `${
              platform.architecture === 'amd64'
                ? 'X86_64'
                : platform.architecture.toUpperCase()
            }`,
          },
        },
        desiredCount: 1,
      },
      { parent: this }
    );

    new EcsDeploymentFailureAlarm(
      `${BASE_NAME}-deployment-failure-alarm`,
      {
        serviceName: BASE_NAME,
        serviceArn: this.service.service.arn,
        tags,
      },
      { parent: this }
    );
  }
}
