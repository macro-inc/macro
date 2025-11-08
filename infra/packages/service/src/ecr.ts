import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as docker_build from '@pulumi/docker-build';
import { CacheMode, Platform } from '@pulumi/docker-build';
import * as pulumi from '@pulumi/pulumi';

export class EcrImage extends pulumi.ComponentResource {
  public ecr: awsx.ecr.Repository;
  public image: pulumi.Output<aws.ecr.GetImageResult>;
  public tags: { [key: string]: string };

  constructor(
    name: string,
    {
      repositoryId,
      repositoryName,
      imageId,
      imagePath,
      platform,
      dockerfile,
      buildArgs,
      tags,
    }: {
      repositoryId: string;
      repositoryName: string;
      imageId: string;
      imagePath: string;
      platform: { family: string; architecture: string };
      dockerfile?: string;
      buildArgs?: { [key: string]: string };
      tags: { [key: string]: string };
    },

    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:EcrImage', name, {}, opts);
    this.tags = tags;
    this.ecr = new awsx.ecr.Repository(
      repositoryId,
      {
        name: repositoryName,
        imageTagMutability: 'MUTABLE',
        forceDelete: true,
        tags: this.tags,
      },
      { parent: this }
    );

    const useExistingImage = process.env.USE_EXISTING_IMAGE === 'true';

    if (useExistingImage) {
      console.log('Using existing ECR image (tag: local) for service');
      // Use the already-pushed image in ECR by tag
      this.image = pulumi.output(
        aws.ecr.getImage({
          repositoryName,
          imageTag: 'local',
        })
      );
    } else {
      const platformStr = `${platform.family}/${platform.architecture}`;
      if (!Object.values(Platform).includes(platformStr as any)) {
        throw new Error(`Unsupported platform: ${platformStr}`);
      }
      let platformEnum = platformStr as Platform;

      const authToken = this.ecr.repository.registryId.apply((registryId) =>
        aws.ecr.getAuthorizationToken({
          registryId,
        })
      );
      const repositoryUrl = this.ecr.url;

      // Build and push Docker image to ECR
      const image = new docker_build.Image(imageId, {
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
          location: imagePath,
        },
        dockerfile: dockerfile
          ? { location: `${imagePath}/${dockerfile}` }
          : undefined,
        platforms: [platformEnum],
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

      this.image = pulumi
        .all([image.digest, this.ecr.repository.name])
        .apply(([digest, repositoryName]) =>
          aws.ecr.getImage({
            repositoryName,
            imageDigest: digest,
          })
        );
    }
  }
}
