import * as pulumi from '@pulumi/pulumi';
import { stack } from '../../shared';

export function getKafkaClusterPolicy(): pulumi.Output<string> {
  const kafkaClusterStack = new pulumi.StackReference('kafka-cluster-stack', {
    name: `macro-inc/kafka-cluster/${stack}`,
  });

  return kafkaClusterStack
    .getOutput('clientAccessPolicyArn')
    .apply((arn) => arn as string);
}
