import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import { stack } from '../../packages/shared';

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
        // Count, not age: once `latest` moves, the image the previous task
        // definition pins is untagged, and ECS rollbacks and task
        // replacements still need to pull it.
        description: 'keep the 20 most recent untagged images',
        selection: {
          tagStatus: 'untagged',
          countType: 'imageCountMoreThan',
          countNumber: 20,
        },
        action: {
          type: 'expire',
        },
      },
    ],
  },
});

export const cloudStorageCacheEcrRepositoryUrl = ecrRepository.url;
