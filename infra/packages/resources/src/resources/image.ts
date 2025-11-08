import * as awsx from '@pulumi/awsx';
import { stack } from '@shared';

export function createImage(
  serviceName: string,
  pathToDockerfile: string,
  platform?: string
) {
  const ecr = new awsx.ecr.Repository(`${serviceName}-ecr-${stack}`, {
    name: `${serviceName}-${stack}`,
    imageTagMutability: 'MUTABLE',
    forceDelete: true,
  });
  const image = new awsx.ecr.Image(`${serviceName}-image-${stack}`, {
    imageTag: 'latest',
    context: pathToDockerfile,
    platform: platform ?? 'linux/arm64',
    repositoryUrl: ecr.url,
  });
  return { ecr, image };
}
