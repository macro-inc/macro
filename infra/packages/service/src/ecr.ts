import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as command from '@pulumi/command';
import * as pulumi from '@pulumi/pulumi';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

function nixImageTarHash(): string {
  const tar = process.env.NIX_DOCKER_IMAGE_TAR;
  if (!tar || !fs.existsSync(tar)) {
    return '';
  }
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(tar));
  return hash.digest('hex');
}

export class EcrImage extends pulumi.ComponentResource {
  public ecr: awsx.ecr.Repository;
  public image: { imageUri: pulumi.Output<string> };
  public tags: { [key: string]: string };

  constructor(
    name: string,
    {
      repositoryId,
      repositoryName,
      imageId,
      nixImage,
      tags,
    }: {
      repositoryId: string;
      repositoryName: string;
      imageId: string;
      /** Flake package that produces a dockerTools archive, e.g. `docker-image-authentication-service`. */
      nixImage: string;
      platform: { family: string; architecture: string };
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

    const repoRoot =
      process.env.MACRO_REPO_ROOT ?? path.resolve(process.cwd(), '../../..');
    const pushScript = path.join(
      repoRoot,
      'tooling/scripts/push-nix-docker-image.sh'
    );

    const push = new command.local.Command(
      `${imageId}-nix-push`,
      {
        create: pulumi.interpolate`${pushScript} ${nixImage} ${this.ecr.url}:latest`,
        triggers: [
          nixImage,
          process.env.NIX_DOCKER_IMAGE_TAR ?? '',
          nixImageTarHash(),
        ],
      },
      { parent: this, dependsOn: [this.ecr] }
    );

    this.image = {
      imageUri: push.stdout.apply((s) => s.trim()),
    };
  }
}
