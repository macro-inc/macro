import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { RDS_PORT, stack } from '@shared';

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
    password: pulumi.Output<string> | string | undefined;
    allocatedStorage: number;
  };
};

export class Database extends pulumi.ComponentResource {
  tags: { [key: string]: string };
  db: aws.rds.Instance | undefined;
  endpoint: pulumi.Output<string>;

  constructor(
    name: string,
    args: DatabaseArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:RdsDatabase', `${name}-${stack}`, {}, opts);
    const { dbArgs, publiclyAccessible, tags, vpc } = args;
    const { dbName, instanceClass, allocatedStorage } = dbArgs;
    this.tags = tags;

    const securityGroup = new aws.ec2.SecurityGroup(
      `${name}-sg-${stack}`,
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
      `${name}-ingress-${stack}`,
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
        `${name}-all-in-${stack}`,
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
      `${name}-subnet-group-${stack}`,
      {
        name: `${name}-subnet-group-${stack}`,
        description: `Subnet group for ${name} ${stack} RDS instance`,
        subnetIds: publiclyAccessible
          ? vpc.publicSubnetIds
          : vpc.privateSubnetIds, // Fixed the subnet selection
        tags,
      },
      { parent: this }
    );

    this.db = new aws.rds.Instance(
      `${name}-rds-instance-${stack}`,
      {
        identifier: `${name}-${stack}`,
        engine: 'postgres',
        engineVersion: '16.8',
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
        deletionProtection: stack === 'prod',
        parameterGroupName: 'default.postgres16',
        enabledCloudwatchLogsExports: ['postgresql', 'upgrade'],
        password: args.dbArgs.password,
        multiAz: true,
        storageEncrypted: true,
        backupRetentionPeriod: 7, // Number of days to retain backups
        backupWindow: '03:00-04:00', // UTC time
        maintenanceWindow: 'Mon:07:30-Mon:08:30', // 2:30-3:30am EST / 3:30-4:30am EDT
        tags,
      },
      { parent: this }
    );

    this.endpoint = this.db.endpoint;

    this.registerOutputs({
      endpoint: this.endpoint,
    });
  }
}
