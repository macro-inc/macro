import * as awsx from '@pulumi/awsx';
import { stack } from '@shared';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'cloud-storage-cache',
};

const BASE_NAME = 'cloud-storage-cache';

const ecrRepository = new awsx.ecr.Repository(`${BASE_NAME}-ecr`, {
  name: `${BASE_NAME}`,
  imageTagMutability: 'MUTABLE',
  forceDelete: true,
  tags: tags,
});

export const cloudStorageCacheEcrRepositoryUrl = ecrRepository.url;
