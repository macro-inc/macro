import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { RDS_PORT, stack } from './resources/shared';

type DatabaseArgs = {
  publiclyAccessible: boolean;
  tags: { [key: string]: string };
  vpc: {
    vpcId: pulumi.Output<string> | string;
    publicSubnetIds: pulumi.Output<string[]> | string[];
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  dbArgs: {
    dbName: string;
    instanceClass: string;
    password: pulumi.Output<string> | string;
    allocatedStorage: number;
  };
};

export class Database extends pulumi.ComponentResource {
  tags: { [key: string]: string };
  db: aws.rds.Instance | undefined;
  endpoint: pulumi.Output<string> | undefined;

  constructor(
    name: string,
    args: DatabaseArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:RdsDatabase', name, {}, opts);
    const { dbArgs, publiclyAccessible, tags, vpc } = args;
    const { dbName, password, instanceClass, allocatedStorage } = dbArgs;

    this.tags = tags;

    const securityGroup = new aws.ec2.SecurityGroup(
      `${name}-sg`,
      {
        name: `${name}-sg-${stack}`,
        description: `${name} security group for ${stack}`,
        egress: [
          {
            description: 'Allow RDS traffic out',
            cidrBlocks: ['0.0.0.0/0'],
            protocol: 'tcp',
            fromPort: RDS_PORT,
            toPort: RDS_PORT,
          },
        ],
        vpcId: vpc.vpcId,
        tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupIngressRule(
      `${name}-ingress`,
      {
        description: 'Allow internal RDS traffic',
        fromPort: RDS_PORT,
        toPort: RDS_PORT,
        ipProtocol: 'tcp',
        cidrIpv4: '10.0.0.0/16',
        securityGroupId: securityGroup.id,
        tags,
      },
      { parent: this }
    );

    if (publiclyAccessible) {
      new aws.vpc.SecurityGroupIngressRule(
        `${name}-all-in`,
        {
          description: 'Allow all inbounds',
          fromPort: RDS_PORT,
          toPort: RDS_PORT,
          ipProtocol: 'tcp',
          cidrIpv4: '0.0.0.0/0',
          securityGroupId: securityGroup.id,
          tags,
        },
        { parent: this }
      );
    }

    const dbSubnetGroup = new aws.rds.SubnetGroup(
      `${name}-subnet-group`,
      {
        name: `${name}-subnet-group-${stack}`,
        description: `Subnet group for ${name} ${stack} RDS instance`,
        subnetIds: publiclyAccessible
          ? vpc.publicSubnetIds
          : vpc.publicSubnetIds,
        tags,
      },
      { parent: this }
    );

    // For prod we had to snapshot and then encrypt the db.
    if (stack !== 'prod') {
      this.db = new aws.rds.Instance(
        `${name}-rds-instance`,
        {
          identifier: `${name}-${stack}`,
          engine: 'postgres',
          engineVersion: '16.2',
          instanceClass,
          storageType: 'gp3',
          allocatedStorage,
          maxAllocatedStorage: 2 * allocatedStorage,
          username: 'macrouser',
          dbName,
          dbSubnetGroupName: dbSubnetGroup.name,
          vpcSecurityGroupIds: [securityGroup.id],
          publiclyAccessible,
          skipFinalSnapshot: true,
          deletionProtection: false,
          parameterGroupName: 'default.postgres16',
          enabledCloudwatchLogsExports: ['postgresql', 'upgrade'],
          password,
          multiAz: true,
          tags,
        },
        { parent: this }
      );
      this.endpoint = this.db.endpoint;
    }
  }
}
