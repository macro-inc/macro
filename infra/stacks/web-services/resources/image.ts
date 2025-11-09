import * as awsx from '@pulumi/awsx';

type ServiceImageArgs = {
  stack: string;
  serviceName: string;
  dockerfilePath: string;
  platform: string;
};

export function serviceImage({
  stack,
  serviceName,
  dockerfilePath,
  platform,
}: ServiceImageArgs) {
  const serviceRepo = new awsx.ecr.Repository(`${serviceName}-repo-${stack}`);
  const serviceImage = new awsx.ecr.Image(`${serviceName}-image-${stack}`, {
    context: dockerfilePath,
    platform,
    repositoryUrl: serviceRepo.url,
  });
  return serviceImage;
}
