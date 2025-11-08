import * as pulumi from '@pulumi/pulumi';
import { stack } from '@shared';

export const cloudStorageStack = new pulumi.StackReference(
  'cloud-storage-stack',
  {
    name: `macro-inc/document-storage/${stack}`,
  }
);

export const cloudStorageClusterName = cloudStorageStack.requireOutput(
  'cloudStorageClusterName'
) as pulumi.Output<string>;

export const cloudStorageClusterArn = cloudStorageStack.requireOutput(
  'cloudStorageClusterArn'
) as pulumi.Output<string>;
