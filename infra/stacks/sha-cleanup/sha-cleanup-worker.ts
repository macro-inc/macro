import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import type { Output } from '@pulumi/pulumi';
import * as pulumi from '@pulumi/pulumi';
import { EcrImage } from '../../packages/service';
import { stack } from '../../packages/shared';

const BASE_NAME = `sha-cleaner-worker`;
const WORKER_NAME = `${BASE_NAME}-${stack}`;

type CreateShaCleanupWorkerArgs = {
  containerEnvVars?: { name: string; value: Output<string> | string }[];
  platform: { family: string; architecture: 'amd64' | 'arm64' };
  documentStorageBucketArn: Output<string> | string;
  tags: { [key: string]: string };
};

export class ShaWorker extends pulumi.ComponentResource {
  public role: aws.iam.Role;
  public ecr: awsx.ecr.Repository;
  public image: { imageUri: pulumi.Output<string> };
  public taskDefinition: awsx.ecs.FargateTaskDefinition;
  constructor(
    name: string,
    {
      platform,
      containerEnvVars,
      documentStorageBucketArn,
      tags,
    }: CreateShaCleanupWorkerArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:ShaWorker', name, {}, opts);
    const image = new EcrImage(
      `${BASE_NAME}-ecr-image-${stack}`,
      {
        repositoryId: `${BASE_NAME}-ecr-${stack}`,
        repositoryName: `${BASE_NAME}-${stack}`,
        imageId: `${BASE_NAME}-image-${stack}`,
        nixImage: 'docker-image-sha-cleanup-worker',
        platform,
        tags,
      },
      { parent: this }
    );
    this.ecr = image.ecr;
    this.image = image.image;

    const docStorageBucketPolicy = new aws.iam.Policy(
      `${BASE_NAME}-doc-storage-policy-${stack}`,
      {
        name: `${BASE_NAME}-doc-storage-bucket-policy-${stack}`,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: ['s3:DeleteObject'],
              Resource: [
                documentStorageBucketArn,
                pulumi.interpolate`${documentStorageBucketArn}/*`,
              ],
              Effect: 'Allow',
            },
          ],
        },
        tags,
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
      },
      { parent: this }
    );

    new aws.iam.RolePolicyAttachment(
      `${BASE_NAME}-role-doc-storage-att-${stack}`,
      {
        role: this.role,
        policyArn: docStorageBucketPolicy.arn,
      },
      { parent: this }
    );

    this.taskDefinition = new awsx.ecs.FargateTaskDefinition(
      `${BASE_NAME}-task-def-${stack}`,
      {
        cpu: '256',
        memory: '512',
        taskRole: { roleArn: this.role.arn },
        container: {
          name: WORKER_NAME,
          image: this.image.imageUri,
          cpu: 256, // Specify CPU units
          memory: 512, // Specify memory in MB
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
