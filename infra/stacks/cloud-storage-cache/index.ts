import * as aws from '@pulumi/aws';
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
  lifecyclePolicy: {
    // we don't want the default lifecycle policy
    skip: true,
  },
  tags: tags,
});

new aws.ecr.LifecyclePolicy(`${BASE_NAME}-lifecycle-policy`, {
  repository: ecrRepository.repository.id,
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
});

export const cloudStorageCacheEcrRepositoryUrl = ecrRepository.url;
