const REDIS_PORT = 6379;
const BASE_NAME = 'cloud-storage-cache';

import * as aws from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';
import type * as pulumi from '@pulumi/pulumi';
import { stack } from '@shared';
import { coparse_api_vpc_filtered_subnets } from '@vpc';

export function getRedisInstance(vpc: {
  vpcId: pulumi.Output<string> | string;
  publicSubnetIds: pulumi.Output<string[]> | string[];
  privateSubnetIds: pulumi.Output<string[]> | string[];
}): {
  securityGroup: aws.ec2.SecurityGroup;
  redisHostedInstance: aws.memorydb.Cluster;
  redisEndpoint: pulumi.Output<string>;
} {
  const securityGroup = new aws.ec2.SecurityGroup(`${BASE_NAME}-sg-${stack}`, {
    description: `${BASE_NAME} security group for ${stack}`,
    name: `${BASE_NAME}-sg-${stack}`,
    egress: [
      {
        description: 'Allow Redis traffic out',
        cidrBlocks: ['0.0.0.0/0'],
        protocol: 'tcp',
        fromPort: REDIS_PORT, // Redis port
        toPort: REDIS_PORT, // Redis port
      },
    ],
    vpcId: vpc.vpcId,
  });

  new aws.vpc.SecurityGroupIngressRule(`${BASE_NAME}-ingress`, {
    description: 'Allow internal Redis traffic',
    fromPort: REDIS_PORT, // Redis port
    toPort: REDIS_PORT, // Redis port
    ipProtocol: 'tcp',
    cidrIpv4: '10.0.0.0/16',
    securityGroupId: securityGroup.id,
  });

  const cacheSubnetGroup = new awsNative.memorydb.SubnetGroup(
    `${BASE_NAME}-subnet-group-${stack}`,
    {
      subnetGroupName: `${BASE_NAME}-subnet-group-${stack}`,
      description: `subnet group for ${BASE_NAME} ${stack}`,
      subnetIds: coparse_api_vpc_filtered_subnets([
        'us-east-1a',
        'us-east-1c',
        'us-east-1d',
      ]),
    }
  );

  const redisHostedInstance = new aws.memorydb.Cluster(
    `${BASE_NAME}-memorydb-${stack}`,
    {
      name: stack === 'prod' ? `${BASE_NAME}-memorydb-prod` : undefined,
      aclName: 'open-access', // ensure this ACL exists or create one as needed
      nodeType: stack === 'prod' ? 'db.r7g.large' : 'db.t4g.small',
      numShards: 1,
      numReplicasPerShard: 1,
      subnetGroupName: cacheSubnetGroup.subnetGroupName.apply((n) => n ?? ''),
      securityGroupIds: [securityGroup.id],
      engineVersion: '7.1', // specify the Redis engine version
      parameterGroupName: 'default.memorydb-redis7', // use or create a specific parameter group if required
    }
  );

  const redisHostedEndpoint = redisHostedInstance.clusterEndpoints
    .apply((nodes) => nodes[0])
    .apply((node) => node && `${node?.address}:${node?.port}`)
    .apply((e) => e ?? '');

  const redisEndpoint = redisHostedEndpoint;

  return { securityGroup, redisHostedInstance, redisEndpoint };
}
