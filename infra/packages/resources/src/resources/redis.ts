import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { stack } from '@shared';

type RedisArgs = {
  tags: { [key: string]: string };
  vpc: {
    vpcId: pulumi.Output<string> | string;
    publicSubnetIds: pulumi.Output<string[]> | string[];
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  redisArgs?: {
    nodeType?: string;
    port?: number;
    engineVersion?: string;
  };
};

export class Redis extends pulumi.ComponentResource {
  tags: { [key: string]: string };
  elasticache: aws.elasticache.Cluster | undefined;
  endpoint: pulumi.Output<string>;

  constructor(
    name: string,
    args: RedisArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:Redis', `${name}-${stack}`, {}, opts);

    const { tags, vpc, redisArgs = {} } = args;
    const {
      nodeType = 'cache.t3.micro',
      port = 6379,
      engineVersion = '7.1',
    } = redisArgs;

    this.tags = tags;

    const securityGroup = new aws.ec2.SecurityGroup(
      `${name}-sg-${stack}`,
      {
        name: `${name}-sg-${stack}`,
        description: `${name} security group for ${stack}`,
        egress: [
          {
            description: 'Allow Redis traffic out',
            cidrBlocks: ['0.0.0.0/0'],
            protocol: 'tcp',
            fromPort: port,
            toPort: port,
          },
        ],
        vpcId: vpc.vpcId,
        tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupIngressRule(
      `${name}-ingress-${stack}`,
      {
        description: 'Allow internal Redis traffic',
        fromPort: port,
        toPort: port,
        ipProtocol: 'tcp',
        cidrIpv4: '10.0.0.0/16',
        securityGroupId: securityGroup.id,
        tags,
      },
      { parent: this }
    );

    const subnetGroup = new aws.elasticache.SubnetGroup(
      `${name}-subnet-group-${stack}`,
      {
        name: `${name}-subnet-group-${stack}`,
        description: `Subnet group for ${name} ${stack} Redis instance`,
        subnetIds: vpc.privateSubnetIds,
        tags,
      },
      { parent: this }
    );

    this.elasticache = new aws.elasticache.Cluster(
      `${name}-${stack}`,
      {
        engine: 'redis',
        engineVersion,
        nodeType,
        numCacheNodes: 1,
        port,
        subnetGroupName: subnetGroup.name,
        securityGroupIds: [securityGroup.id],
        applyImmediately: true,
        maintenanceWindow: 'sun:05:00-sun:06:00',
        snapshotWindow: '03:00-04:00',
        snapshotRetentionLimit: stack === 'prod' ? 7 : 0,
        tags,
      },
      { parent: this }
    );

    this.endpoint = this.elasticache.cacheNodes[0].address;

    this.registerOutputs({
      endpoint: this.endpoint,
    });
  }
}
