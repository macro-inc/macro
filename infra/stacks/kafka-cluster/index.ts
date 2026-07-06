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
  instanceType: stack === 'prod' ? 'kafka.m7g.large' : 'kafka.t3.small',
  numberOfBrokerNodes: 3,
  volumeSize: stack === 'prod' ? 100 : 50,
  protect: stack === 'prod',
  kafkaVersion: '3.9.x.kraft',
  topics: getKafkaClusterTopics(),
  tags,
});

export const clusterArn = kafkaCluster.cluster.arn;
export const zookeeperConnectString =
  kafkaCluster.cluster.zookeeperConnectString;
// IAM clients use this endpoint (not bootstrapBrokersTls / not the VpcConnectivity one).
export const bootstrapBrokersSaslIam =
  kafkaCluster.cluster.bootstrapBrokersSaslIam;
export const securityGroupId = kafkaCluster.securityGroup.id;
