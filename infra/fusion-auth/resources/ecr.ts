import * as pulumi from '@pulumi/pulumi';
import * as awsx from '@pulumi/awsx';

export class EcrImage extends pulumi.ComponentResource {
  public ecr: awsx.ecr.Repository;
  public image: awsx.ecr.Image;
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
      tags,
    }: {
      repositoryId: string;
      repositoryName: string;
      imageId: string;
      imagePath: string;
      platform: { family: string; architecture: string };
      dockerfile?: string;
      tags: { [key: string]: string };
    },

    opts?: pulumi.ComponentResourceOptions,
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
      { parent: this },
    );
    this.image = new awsx.ecr.Image(
      imageId,
      {
        imageName: imageId,
        imageTag: 'latest',
        context: imagePath,
        dockerfile: dockerfile ? `${imagePath}/${dockerfile}` : undefined,
        platform: `${platform.family}/${platform.architecture}`,
        repositoryUrl: this.ecr.url,
      },
      { parent: this },
    );
  }
}
