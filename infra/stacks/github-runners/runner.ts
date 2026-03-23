import * as fs from 'fs';
import * as path from 'path';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { stack } from '../../packages/shared';

type SmokeTestRunnerArgs = {
  vpc: {
    vpcId: string;
    privateSubnetIds: string[];
  };
  tags: { [key: string]: string };
  runnerUrl: string;
  runnerToken: pulumi.Output<string>;
  instanceType?: string;
  keyPairName?: string;
  volumeSizeGb?: number;
};

export class SmokeTestRunner extends pulumi.ComponentResource {
  public instance: aws.ec2.Instance;
  public sg: aws.ec2.SecurityGroup;
  public role: aws.iam.Role;
  public instanceProfile: aws.iam.InstanceProfile;

  constructor(
    name: string,
    args: SmokeTestRunnerArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('macro:components:SmokeTestRunner', name, {}, opts);

    const {
      vpc,
      tags,
      runnerUrl,
      runnerToken,
      instanceType = 't3.large',
      keyPairName,
      volumeSizeGb = 100,
    } = args;

    // ── AMI ───────────────────────────────────────────────────────────────
    const ami = aws.ec2.getAmiOutput({
      mostRecent: true,
      owners: ['099720109477'], // Canonical
      filters: [
        {
          name: 'name',
          values: [
            'ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*',
          ],
        },
        { name: 'virtualization-type', values: ['hvm'] },
      ],
    });

    // ── Security Group ────────────────────────────────────────────────────
    this.sg = new aws.ec2.SecurityGroup(
      `${name}-sg`,
      {
        name: `${name}-sg-${stack}`,
        vpcId: vpc.vpcId,
        description: `GitHub Actions runner: ${name}`,
        tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupEgressRule(
      `${name}-all-out`,
      {
        securityGroupId: this.sg.id,
        description: 'Allow all outbound',
        cidrIpv4: '0.0.0.0/0',
        ipProtocol: '-1',
        tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupIngressRule(
      `${name}-vpc-in`,
      {
        securityGroupId: this.sg.id,
        description: 'Allow VPC inbound',
        cidrIpv4: '10.0.0.0/16',
        ipProtocol: '-1',
        tags,
      },
      { parent: this }
    );

    // ── IAM ───────────────────────────────────────────────────────────────
    this.role = new aws.iam.Role(
      `${name}-role`,
      {
        name: `${name}-role-${stack}`,
        assumeRolePolicy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { Service: 'ec2.amazonaws.com' },
              Action: 'sts:AssumeRole',
            },
          ],
        }),
        tags,
      },
      { parent: this }
    );

    new aws.iam.RolePolicyAttachment(
      `${name}-ssm`,
      {
        role: this.role.name,
        policyArn: 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore',
      },
      { parent: this }
    );

    this.instanceProfile = new aws.iam.InstanceProfile(
      `${name}-instance-profile`,
      {
        name: `${name}-profile-${stack}`,
        role: this.role.name,
        tags,
      },
      { parent: this }
    );

    // ── User Data ─────────────────────────────────────────────────────────
    const userDataScript = fs.readFileSync(
      path.join(__dirname, 'user-data.sh'),
      'utf-8'
    );

    const userData = runnerToken.apply((token) =>
      userDataScript.replace(
        'set -euo pipefail',
        [
          'set -euo pipefail',
          `export GITHUB_RUNNER_URL="${runnerUrl}"`,
          `export GITHUB_RUNNER_TOKEN="${token}"`,
          `export GITHUB_RUNNER_NAME="${name}-$(curl -s http://169.254.169.254/latest/meta-data/instance-id)"`,
        ].join('\n')
      )
    );

    // ── EC2 Instance ──────────────────────────────────────────────────────
    this.instance = new aws.ec2.Instance(
      `${name}`,
      {
        ami: ami.id,
        instanceType,
        subnetId: vpc.privateSubnetIds[0],
        vpcSecurityGroupIds: [this.sg.id],
        iamInstanceProfile: this.instanceProfile.name,
        keyName: keyPairName,
        userData,
        userDataReplaceOnChange: true,
        rootBlockDevice: {
          volumeSize: volumeSizeGb,
          volumeType: 'gp3',
          encrypted: true,
        },
        tags: {
          ...tags,
          Name: `${name}-${stack}`,
        },
      },
      { parent: this }
    );
  }
}
