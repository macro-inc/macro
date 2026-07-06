import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

// MSK broker listener port for IAM (SASL_SSL / OAUTHBEARER) auth.
const KAFKA_IAM_PORT = 9098;
// open-monitoring Prometheus exporter ports (enabled via openMonitoring below).
const JMX_EXPORTER_PORT = 11001;
const NODE_EXPORTER_PORT = 11002;

export type TopicArgs = {
  // Name of topic
  name: string;
  // The number of partitions
  partitionCount: number;
  replicationFactor: number;
  // Stringified json of topic config
  configs: string;
};

type Args = {
  vpc: {
    vpcId: string;
    publicSubnetIds: string[];
    privateSubnetIds: string[];
  };
  // 3 brokers == 3 client subnets (one per AZ). numberOfBrokerNodes must stay a
  // multiple of clientSubnets.length.
  numberOfBrokerNodes: number;
  instanceType: string;
  volumeSize: number;
  // Cluster-wide default log retention in hours, applied via the MSK
  // configuration's `log.retention.hours`. Individual topics can override this
  // at creation time with their own `retention.ms` / `retention.bytes`.
  // Defaults to 168h (7 days), which is Kafka's own default.
  retentionHours?: number;
  protect: boolean;
  // Topics to add to cluster
  topics: TopicArgs[];
  kafkaVersion: string;
  tags: { [key: string]: string };
};

/**
 * A Kafka Cluster
 * The name will become the name of the cluster
 */
export class KafkaCluster extends pulumi.ComponentResource {
  public tags: { [key: string]: string };
  public securityGroup: aws.ec2.SecurityGroup;
  public logGroup: aws.cloudwatch.LogGroup;
  public cluster: aws.msk.Cluster;
  public topics: Map<string, aws.msk.Topic>;

  constructor(
    name: string,
    {
      vpc,
      numberOfBrokerNodes,
      instanceType,
      volumeSize,
      retentionHours = 168,
      protect,
      topics,
      kafkaVersion,
      tags,
    }: Args,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:KafkaCluster', name, {}, opts);
    this.tags = {
      ...tags,
      cluster: name,
    };

    // The vpc package only hands us IDs, so look up the real CIDR rather than
    // hardcoding one. Ingress/egress are scoped to this so nothing outside the
    // VPC can reach the brokers.
    const vpcCidr = aws.ec2.getVpcOutput({ id: vpc.vpcId }).cidrBlock;

    this.securityGroup = new aws.ec2.SecurityGroup(
      'sg',
      {
        namePrefix: name,
        vpcId: vpc.vpcId,
        description: 'MSK Kafka cluster broker access restricted to the VPC',
        egress: [
          {
            protocol: '-1',
            fromPort: 0,
            toPort: 0,
            cidrBlocks: [vpcCidr],
            description: 'All traffic within the VPC only',
          },
        ],
        ingress: [
          {
            protocol: 'tcp',
            fromPort: KAFKA_IAM_PORT,
            toPort: KAFKA_IAM_PORT,
            cidrBlocks: [vpcCidr],
            description: 'Kafka IAM SASL_SSL clients within the VPC',
          },
          {
            // Inter-broker replication/coordination. Brokers share this SG, so a
            // self-referencing rule lets them talk to each other on any port without
            // widening exposure to the rest of the VPC.
            protocol: '-1',
            fromPort: 0,
            toPort: 0,
            self: true,
            description: 'Interbroker traffic',
          },
          {
            protocol: 'tcp',
            fromPort: JMX_EXPORTER_PORT,
            toPort: NODE_EXPORTER_PORT,
            cidrBlocks: [vpcCidr],
            description:
              'Prometheus scraping JMX + node exporter within the VPC',
          },
        ],
        tags,
      },
      { parent: this }
    );

    this.logGroup = new aws.cloudwatch.LogGroup(
      'log-group',
      {
        namePrefix: name,
        retentionInDays: 7,
        tags,
      },
      { parent: this }
    );

    // Cluster-wide Kafka server.properties. Retention defaults live here; add
    // any other broker-level defaults (e.g. min.insync.replicas,
    // default.replication.factor) to this block as the cluster grows.
    const configuration = new aws.msk.Configuration(
      'config',
      {
        name: `${name}-config`,
        serverProperties: `log.retention.hours=${retentionHours}\n`,
      },
      { parent: this }
    );

    this.cluster = new aws.msk.Cluster(
      `cluster`,
      {
        clusterName: name,
        kafkaVersion,
        numberOfBrokerNodes,
        configurationInfo: {
          arn: configuration.arn,
          revision: configuration.latestRevision,
        },
        brokerNodeGroupInfo: {
          instanceType,
          clientSubnets: [
            ...vpc.privateSubnetIds, // private subnets in AZs a, b and c
          ],
          storageInfo: {
            ebsStorageInfo: {
              volumeSize,
            },
          },
          securityGroups: [this.securityGroup.id],
        },
        // IAM authentication for in-VPC clients: no usernames/passwords or secrets to
        // manage. Clients authenticate with their IAM role via SASL/OAUTHBEARER and
        // connect on the bootstrapBrokersSaslIam endpoint (port 9098). publicAccess
        // defaults to DISABLED, and we are NOT using multi-VPC (vpcConnectivity)
        // since all clients live in this VPC.
        clientAuthentication: {
          sasl: { iam: true },
        },
        encryptionInfo: {
          encryptionInTransit: {
            clientBroker: 'TLS',
            inCluster: true,
          },
        },
        openMonitoring: {
          prometheus: {
            jmxExporter: {
              enabledInBroker: true,
            },
            nodeExporter: {
              enabledInBroker: true,
            },
          },
        },
        loggingInfo: {
          brokerLogs: {
            cloudwatchLogs: {
              enabled: true,
              logGroup: this.logGroup.name,
            },
          },
        },
        tags,
      },
      { protect, parent: this }
    );

    this.topics = new Map();
    for (const topic of topics) {
      this.topics.set(
        topic.name,
        new aws.msk.Topic(
          `${topic.name}-topic`,
          {
            name: topic.name,
            clusterArn: this.cluster.arn,
            partitionCount: topic.partitionCount,
            replicationFactor: topic.replicationFactor,
            configs: topic.configs,
          },
          { parent: this, dependsOn: [this.cluster] }
        )
      );
    }
  }
}
