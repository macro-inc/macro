import { stack } from '../../packages/shared';
import * as pulumi from '@pulumi/pulumi';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { KafkaCluster } from '../../packages/resources';
import { getKafkaClusterTopics } from './topics';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: pulumi.getProject(),
};

const vpc = get_coparse_api_vpc();

const kafkaCluster = new KafkaCluster(`${stack}-macro-event-kafka-cluster`, {
  vpc,
  instanceType: 'kafka.m7g.large', // smallest instance size kraft version supports (more expensive but futureproof)
  numberOfBrokerNodes: 3,
  volumeSize: stack === 'prod' ? 100 : 25,
  protect: stack === 'prod',
  kafkaVersion: '3.9.x.kraft',
  topics: getKafkaClusterTopics(),
  tags,
});

export const clusterArn = kafkaCluster.cluster.arn;
// IAM clients use this endpoint (not bootstrapBrokersTls / not the VpcConnectivity one).
export const bootstrapBrokersSaslIam =
  kafkaCluster.cluster.bootstrapBrokersSaslIam;
export const securityGroupId = kafkaCluster.securityGroup.id;

// Producer + consumer access to the cluster and all its topics/groups. Attach
// to the ECS task role of any service that publishes or consumes events:
//
//   const kafkaClusterStack = new pulumi.StackReference('kafka-cluster', {
//     name: `macro-inc/kafka-cluster/${stack}`,
//   });
//   new aws.iam.RolePolicyAttachment('kafka-client-access', {
//     role: taskRole.name,
//     policyArn: kafkaClusterStack
//       .getOutput('clientAccessPolicyArn')
//       .apply((arn) => arn as string),
//   });
export const clientAccessPolicyArn = kafkaCluster.clientAccessPolicy.arn;
