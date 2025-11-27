import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';

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
          // We do not want the default lifecycle policy for the repositories
          skip: true,
        },
      },
      { parent: this }
    );

    new aws.ecr.LifecyclePolicy(
      `${repositoryId}-lifecycle-policy`,
      {
        repository: this.ecr.repository.id,
        policy: {
          rules: [
            {
              rulePriority: 1,
              description: 'remove untagged images older than 1 day',
              selection: {
                tagStatus: 'untagged',
                countType: 'sinceImagePushed',
                countUnit: 'days',
                countNumber: 1,
              },
              action: {
                type: 'expire',
              },
            },
          ],
        },
      },
      { parent: this }
    );

    this.image = new awsx.ecr.Image(
      imageId,
      {
        imageTag: 'latest',
        context: imagePath,
        platform: `${platform.family}/${platform.architecture}`,
        dockerfile: dockerfile ? `${imagePath}/${dockerfile}` : undefined,
        repositoryUrl: this.ecr.url,
        args: buildArgs,
      },
      { parent: this }
    )
  }
}
