import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as docker_build from '@pulumi/docker-build';
import { CacheMode } from '@pulumi/docker-build';
import * as pulumi from '@pulumi/pulumi';
import { stack } from '@shared';

export class ServiceEcrImage extends pulumi.ComponentResource {
  public readonly ecr: awsx.ecr.Repository;
  public readonly imageRef: pulumi.Output<string>;
  public readonly tags: Record<string, string>;

  constructor(
    serviceName: string,
    args: {
      context: string;
      arm64?: boolean;
      dockerfile?: string;
      buildArgs?: Record<string, string>;
      tags: Record<string, string>;
    },

    opts?: pulumi.ComponentResourceOptions
  ) {
    super(
      'macro:cloud_storage:ServiceEcrImage',
      `${serviceName}-service-ecr-${stack}`,
      args,
      opts
    );
    const { context, arm64, dockerfile, buildArgs, tags } = args;
    this.tags = tags;
    this.ecr = new awsx.ecr.Repository(
      `${serviceName}-ecr-${stack}`,
      {
        name: `${serviceName}-${stack}`,
        imageTagMutability: 'MUTABLE',
        forceDelete: true,
        tags: this.tags,
      },
      { parent: this }
    );

    const authToken = this.ecr.repository.registryId.apply((registryId) =>
      aws.ecr.getAuthorizationToken({
        registryId,
      })
    );
    const repositoryUrl = this.ecr.url;

    // Build and push Docker image to ECR
    const image = new docker_build.Image(`${serviceName}-image-${stack}`, {
      buildArgs,
      noCache: process.env.CACHE === 'false',
      cacheFrom: [
        {
          registry: {
            ref: pulumi.interpolate`${this.ecr.url}:cache`,
          },
        },
      ],
      cacheTo: [
        {
          registry: {
            mode: CacheMode.Max,
            imageManifest: true,
            ociMediaTypes: true,
            ref: pulumi.interpolate`${repositoryUrl}:cache`,
          },
        },
      ],
      context: {
        location: context,
      },
      dockerfile: dockerfile ? { location: dockerfile } : undefined,
      platforms: [arm64 ? 'linux/arm64' : 'linux/amd64'],
      push: true,
      registries: [
        {
          address: repositoryUrl,
          password: authToken.apply((authToken) => authToken.password),
          username: authToken.apply((authToken) => authToken.userName),
        },
      ],
      tags: [pulumi.interpolate`${repositoryUrl}:latest`],
    });

    this.imageRef = image.ref;
    this.registerOutputs({
      imageRef: image.ref,
    });
  }
}
