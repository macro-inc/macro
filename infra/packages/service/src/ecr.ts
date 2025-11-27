import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
// import * as docker_build from '@pulumi/docker-build';
// import { CacheMode, Platform } from '@pulumi/docker-build';
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
        lifecyclePolicy: {
          // We do not want a lifecycle policy for the repositories
          skip: true,
        },
      },
      { parent: this }
    );

    const image = new awsx.ecr.Image(
      imageId,
      {
        imageTag: 'latest',
        context: imagePath,
        platform: `${platform.family}/${platform.architecture}`,
        dockerfile: dockerfile ? `${imagePath}/${dockerfile}` : undefined,
        repositoryUrl: this.ecr.url,
        args: buildArgs,
      },
      { parent: this, retainOnDelete: true, ignoreChanges: ['tags'] }
    )

    // Create an image output
    this.image = pulumi
      .all([this.ecr.repository.name, image.imageUri])
      .apply(([repositoryName, imageUri]) => {
        console.log(`Image URI: ${imageUri}`);

        return aws.ecr.getImage({
          repositoryName,
          imageTag: 'latest', // Use the latest tag
        });
      });

    // Register the image as an output to ensure it's tracked
    this.registerOutputs({
      ecrRepository: this.ecr,
      imageUri: image.imageUri,
    });
  }
}
