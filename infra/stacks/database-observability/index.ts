import { gzipSync } from 'node:zlib';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

const config = new pulumi.Config();
const stack = pulumi.getStack();
const region = aws.config.requireRegion();
if (stack !== 'dev' || region !== 'us-east-1') {
  throw new Error('The database collector pilot is dev-only in us-east-1');
}
const amiId = config.require('amiId');
const subnetId = config.require('subnetId');
const secretArn = config.require('secretArn');
const ingestSecretArn = config.require('ingestSecretArn');
for (const arn of [secretArn, ingestSecretArn]) {
  if (
    !/^arn:aws:secretsmanager:us-east-1:569036502058:secret:[a-zA-Z0-9/_+=.@-]+$/.test(
      arn
    )
  ) {
    throw new Error('Secrets must belong to Macro in us-east-1');
  }
}
if (!/^ami-[a-f0-9]+$/.test(amiId) || !/^subnet-[a-f0-9]+$/.test(subnetId)) {
  throw new Error(
    'Configure a reviewed collector AMI and a private database-VPC subnet'
  );
}
const tags = { project: 'database-observability', environment: stack };
const subnet = aws.ec2.getSubnetOutput({ id: subnetId });
const databases = ['macro-db-dev', 'macro-db-dev-read-replica'].map((name) =>
  aws.rds.getInstanceOutput({ dbInstanceIdentifier: name })
);
const group = new aws.ec2.SecurityGroup('database-collector', {
  vpcId: subnet.vpcId,
  description:
    'No inbound access; SSM administration and outbound database metrics',
  tags,
});
const https = new aws.vpc.SecurityGroupEgressRule('database-collector-https', {
  securityGroupId: group.id,
  cidrIpv4: '0.0.0.0/0',
  ipProtocol: 'tcp',
  fromPort: 443,
  toPort: 443,
  tags,
});
const databaseRules = pulumi
  .all(databases.map((db) => db.vpcSecurityGroups))
  .apply((groups) =>
    [...new Set(groups.flat())].flatMap((securityGroupId) => [
      new aws.vpc.SecurityGroupEgressRule(
        `collector-postgres-out-${securityGroupId}`,
        {
          securityGroupId: group.id,
          referencedSecurityGroupId: securityGroupId,
          ipProtocol: 'tcp',
          fromPort: 5432,
          toPort: 5432,
          tags,
        }
      ),
      new aws.vpc.SecurityGroupIngressRule(
        `database-collector-in-${securityGroupId}`,
        {
          securityGroupId,
          referencedSecurityGroupId: group.id,
          ipProtocol: 'tcp',
          fromPort: 5432,
          toPort: 5432,
          tags,
        }
      ),
    ])
  );
const volume = new aws.ebs.Volume(
  'database-collector-data',
  {
    availabilityZone: subnet.availabilityZone,
    type: 'gp3',
    size: 20,
    encrypted: true,
    tags,
  },
  { protect: true, retainOnDelete: true }
);
const role = new aws.iam.Role('database-collector', {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: 'ec2.amazonaws.com',
  }),
  tags,
});
const ssm = new aws.iam.RolePolicyAttachment('database-collector-ssm', {
  role: role.name,
  policyArn: 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore',
});
const secrets = new aws.iam.RolePolicy('database-collector-secrets', {
  role: role.name,
  policy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: 'secretsmanager:GetSecretValue',
        Resource: [secretArn, ingestSecretArn],
      },
    ],
  }),
});
const profile = new aws.iam.InstanceProfile('database-collector', {
  role: role.name,
});
const instance = new aws.ec2.Instance(
  'database-collector',
  {
    ami: amiId,
    instanceType: 't3.small',
    subnetId,
    associatePublicIpAddress: false,
    vpcSecurityGroupIds: [group.id],
    iamInstanceProfile: profile.name,
    metadataOptions: {
      httpEndpoint: 'enabled',
      httpTokens: 'required',
      httpPutResponseHopLimit: 1,
    },
    rootBlockDevice: {
      volumeType: 'gp3',
      volumeSize: 12,
      encrypted: true,
      deleteOnTermination: true,
    },
    userDataReplaceOnChange: true,
    userDataBase64: pulumi
      .all([volume.id, ...databases.map((db) => db.address)])
      .apply(([volumeId, writerHost, replicaHost]) =>
        gzipSync(
          JSON.stringify({
            version: 1,
            region,
            environment: stack,
            volumeId,
            secretArn,
            ingestSecretArn,
            writerHost,
            replicaHost,
          })
        ).toString('base64')
      ),
    tags,
  },
  {
    deleteBeforeReplace: true,
    dependsOn: databaseRules.apply((rules) => [ssm, secrets, https, ...rules]),
  }
);
new aws.ec2.VolumeAttachment(
  'database-collector-data',
  {
    deviceName: '/dev/sdf',
    volumeId: volume.id,
    instanceId: instance.id,
    stopInstanceBeforeDetaching: true,
    forceDetach: false,
  },
  { deleteBeforeReplace: true }
);
export const instanceId = instance.id;
export const dataVolumeId = volume.id;
export const securityGroupId = group.id;
