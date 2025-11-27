import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import type { Output } from '@pulumi/pulumi';
import * as pulumi from '@pulumi/pulumi';
import { EcrImage } from '@service';
import { awsRegion, stack } from '@shared';

// import {
//   DATADOG_API_KEY,
//   datadogAgentContainer,
//   fargateLogRouterSidecarContainer,
// } from '@resources';

const BASE_NAME = `notification-email-poller-worker`;
const WORKER_NAME = `${BASE_NAME}-${stack}`;
const BASE_PATH = '../../../rust/cloud-storage';

type WorkerArgs = {
  containerEnvVars: { name: string; value: Output<string> | string }[];
  platform: { family: string; architecture: 'amd64' | 'arm64' };
  tags: { [key: string]: string };
};

export class Worker extends pulumi.ComponentResource {
  public role: aws.iam.Role;
  public ecr: awsx.ecr.Repository;
  public image: awsx.ecr.Image;
  public taskDefinition: awsx.ecs.FargateTaskDefinition;
  tags: { [key: string]: string };
  constructor(
    name: string,
    { platform, containerEnvVars, tags }: WorkerArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:Worker', name, {}, opts);
    this.tags = tags;

    const image = new EcrImage(
      `${BASE_NAME}-ecr-image-${stack}`,
      {
        repositoryId: `${BASE_NAME}-ecr-${stack}`,
        repositoryName: `${BASE_NAME}-${stack}`,
        imageId: `${BASE_NAME}-image-${stack}`,
        imagePath: BASE_PATH,
        dockerfile: 'Dockerfile',
        platform,
        buildArgs: {
          SERVICE_NAME: 'notification_email_poller_worker',
        },
        tags: this.tags,
      },
      { parent: this }
    );
    this.ecr = image.ecr;
    this.image = image.image;

    const sesPolicy = new aws.iam.Policy(
      `${BASE_NAME}-ses-policy`,
      {
        name: `${BASE_NAME}-ses-policy-${stack}`,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: [
                'ses:SendEmail',
                'ses:SendRawEmail',
                'ses:SendTemplatedEmail',
              ],
              Resource: [
                `arn:aws:ses:${awsRegion}:569036502058:identity/notification.macro.com`,
              ],
              Effect: 'Allow',
            },
          ],
        },
        tags: this.tags,
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
        managedPolicyArns: [sesPolicy.arn],
        tags: this.tags,
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
          image: image.image.imageUri,
          cpu: 256, // Specify CPU units
          memory: 512, // Specify memory in MB
          environment: [...containerEnvVars],
        },
        // containers: {
        //   log_router: fargateLogRouterSidecarContainer,
        //   datadog_agent: datadogAgentContainer,
        //   worker: {
        //     name: WORKER_NAME,
        //     image: image.image.imageUri,
        //     cpu: 256,
        //     memory: 512,
        //     environment: [...containerEnvVars],
        //     logConfiguration: {
        //       logDriver: 'awsfirelens',
        //       options: {
        //         Name: 'datadog',
        //         Host: 'http-intake.logs.us5.datadoghq.com',
        //         apikey: DATADOG_API_KEY,
        //         dd_service: `${WORKER_NAME}`,
        //         dd_source: 'fargate',
        //         dd_tags: 'project:cloudstorage',
        //         provider: 'ecs',
        //       },
        //     },
        //   },
        // },
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
