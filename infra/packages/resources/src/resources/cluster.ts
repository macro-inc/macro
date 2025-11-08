import * as aws from '@pulumi/aws';
import type { Cluster } from '@pulumi/aws/ecs';
import { stack } from '@shared';

export function create_cluster(): Cluster {
  return new aws.ecs.Cluster(`cluster-${stack}`);
}
