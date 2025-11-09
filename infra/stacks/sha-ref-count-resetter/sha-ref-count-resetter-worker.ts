import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import type { Output } from '@pulumi/pulumi';
import * as pulumi from '@pulumi/pulumi';
import { stack } from '@shared';

const BASE_NAME = `sha-ref-count-resetter-worker`;
const WORKER_NAME = `${BASE_NAME}-${stack}`;
const BASE_PATH = '../../../../rust/cloud-storage';

type CreateShaRefCountResetterWorkerArgs = {
  containerEnvVars?: { name: string; value: Output<string> | string }[];
  platform: { family: string; architecture: 'amd64' | 'arm64' };
  tags: { [name: string]: string };
};

export class ShaRefCountResetterWorker extends pulumi.ComponentResource {
  public ecr: awsx.ecr.Repository;
  public image: awsx.ecr.Image;
  public taskDefinition: awsx.ecs.FargateTaskDefinition;
  public role: aws.iam.Role;
  constructor(
    name: string,
    { platform, containerEnvVars, tags }: CreateShaRefCountResetterWorkerArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:ShaRefCountResetterWorker', name, {}, opts);
    this.ecr = new awsx.ecr.Repository(
      `${BASE_NAME}-ecr-${stack}`,
      {
        name: `${BASE_NAME}-${stack}`,
        imageTagMutability: 'MUTABLE',
        forceDelete: true,
        tags,
      },
      { parent: this }
    );
    this.image = new awsx.ecr.Image(
      `${BASE_NAME}-image-${stack}`,
      {
        imageTag: 'latest',
        context: BASE_PATH,
        platform: `${platform.family}/${platform.architecture}`,
        dockerfile: `${BASE_PATH}/Dockerfile.sha-ref-count-resetter`,
        repositoryUrl: this.ecr.url,
      },
      { parent: this }
    );

    this.role = new aws.iam.Role(
      `${BASE_NAME}-role-${stack}`,
      {
        name: `${BASE_NAME}-role-${stack}`,
        assumeRolePolicy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: 'sts:AssumeRole',
              Principal: {
                Service: 'ecs-tasks.amazonaws.com',
              },
              Effect: 'Allow',
              Sid: '',
            },
          ],
        },
        tags,
      },
      { parent: this }
    );

    this.taskDefinition = new awsx.ecs.FargateTaskDefinition(
      `${BASE_NAME}-task-def-${stack}`,
      {
        cpu: '1024',
        memory: '2048',
        taskRole: {
          roleArn: pulumi.interpolate`${this.role.arn}`,
        },
        container: {
          name: WORKER_NAME,
          image: pulumi.interpolate`${this.ecr.repository.repositoryUrl}:latest`,
          cpu: 1024, // Specify CPU units
          memory: 2048, // Specify memory in MB
          environment: containerEnvVars,
        },
        runtimePlatform: {
          operatingSystemFamily: `${platform.family.toUpperCase()}`,
          cpuArchitecture: `${
            platform.architecture === 'amd64'
              ? 'X86_64'
              : platform.architecture.toUpperCase()
          }`,
        },
        tags,
      },
      { parent: this }
    );
  }
}
