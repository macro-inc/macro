import * as fs from 'fs';
import * as path from 'path';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { awsRegion } from '../../packages/shared';

type DbMigratorRunnerArgs = {
  vpc: {
    vpcId: string;
    privateSubnetIds: string[];
  };
  tags: { [key: string]: string };
  /** The organization the runners register with. */
  runnerUrl: string;
  instanceType: string;
  /** Secrets Manager names of the database URLs the jobs read. */
  databaseSecretNames: string[];
  volumeSizeGb?: number;
};

/**
 * The in-VPC self-hosted GitHub Actions runner behind the `db-migrator` label
 * (`runners::DB_MIGRATOR` in `xtask_workflows`): it runs every MacroDB
 * migration, dev and prod, and the jobs that need the database from inside the
 * VPC. One instance, two runner processes so a long rollout job cannot hold
 * the only slot.
 *
 * It must not wedge silently again (2026-11-25: a job compiled Rust on the old
 * 1 GiB hand-made box, which ran out of memory and stopped answering for days):
 *
 * - The runners share a memory-capped systemd slice, so a runaway job is
 *   killed and fails instead of starving the machine. Nothing on the box
 *   compiles: there is no Rust toolchain or Nix, and its `cargo` only
 *   forwards `cargo sqlx` for deploys of older commits.
 * - systemd restarts a runner process that exits.
 * - EC2 reboots the instance when its instance status check fails and
 *   recovers it onto new hardware when the system status check fails. Both
 *   keep the disk, so the runners keep their registration.
 * - No SSH and no public address: reach it with SSM Session Manager.
 * - The runners register after the first boot, from a Session Manager shell,
 *   so the registration token is never in the user data, which every job on
 *   the box can read from the instance metadata service.
 *
 * See `docs/runbooks/db-migrator-runner.md`.
 */
export class DbMigratorRunner extends pulumi.ComponentResource {
  public instance: aws.ec2.Instance;

  constructor(
    name: string,
    args: DbMigratorRunnerArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('macro:components:DbMigratorRunner', name, {}, opts);

    const {
      vpc,
      tags,
      runnerUrl,
      instanceType,
      databaseSecretNames,
      volumeSizeGb = 40,
    } = args;

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

    // Outbound only: GitHub, the package mirrors at bootstrap, SSM, and the
    // databases, whose security groups admit the VPC's CIDR.
    const securityGroup = new aws.ec2.SecurityGroup(
      `${name}-sg`,
      {
        name: `${name}-sg`,
        vpcId: vpc.vpcId,
        description: 'GitHub Actions db-migrator runner: outbound only',
        tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupEgressRule(
      `${name}-all-out`,
      {
        securityGroupId: securityGroup.id,
        description: 'Allow all outbound',
        cidrIpv4: '0.0.0.0/0',
        ipProtocol: '-1',
        tags,
      },
      { parent: this }
    );

    const role = new aws.iam.Role(
      `${name}-role`,
      {
        name: `${name}-role`,
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
        role: role.name,
        policyArn: 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore',
      },
      { parent: this }
    );

    // The migration and rollout jobs read only the database URLs, through
    // the instance's own credentials.
    const databaseSecretArns = databaseSecretNames.map(
      (secretName) =>
        aws.secretsmanager.getSecretOutput({ name: secretName }).arn
    );
    new aws.iam.RolePolicy(
      `${name}-database-secrets`,
      {
        role: role.id,
        policy: pulumi.all(databaseSecretArns).apply((arns) =>
          JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: 'secretsmanager:GetSecretValue',
                Resource: arns,
              },
            ],
          })
        ),
      },
      { parent: this }
    );

    const instanceProfile = new aws.iam.InstanceProfile(
      `${name}-profile`,
      {
        name: `${name}-profile`,
        role: role.name,
        tags,
      },
      { parent: this }
    );

    // No secret: the runners register later (see user-data.sh), and keep
    // their registration on disk across reboots and recoveries.
    const userData = fs
      .readFileSync(path.join(__dirname, 'user-data.sh'), 'utf-8')
      .replace(
        'set -euo pipefail',
        [
          'set -euo pipefail',
          `GITHUB_RUNNER_URL='${runnerUrl}'`,
          `AWS_REGION='${awsRegion}'`,
        ].join('\n')
      );

    this.instance = new aws.ec2.Instance(
      name,
      {
        ami: ami.id,
        instanceType,
        subnetId: vpc.privateSubnetIds[0],
        associatePublicIpAddress: false,
        vpcSecurityGroupIds: [securityGroup.id],
        iamInstanceProfile: instanceProfile.name,
        userData,
        userDataReplaceOnChange: true,
        metadataOptions: {
          httpTokens: 'required',
          httpEndpoint: 'enabled',
          httpPutResponseHopLimit: 1,
        },
        rootBlockDevice: {
          volumeSize: volumeSizeGb,
          volumeType: 'gp3',
          encrypted: true,
        },
        tags: { ...tags, Name: name },
      },
      {
        parent: this,
        // A newer Ubuntu image must not replace a registered runner; the
        // instance takes security updates through unattended-upgrades.
        ignoreChanges: ['ami'],
      }
    );

    // Instance status check: the guest stopped answering (out of memory, a
    // kernel hang). Three failed minutes reboot it.
    new aws.cloudwatch.MetricAlarm(
      `${name}-instance-check`,
      {
        name: `${name}-instance-check`,
        alarmDescription:
          'The db-migrator runner failed its instance status check for 3 minutes; EC2 reboots it. See docs/runbooks/db-migrator-runner.md.',
        namespace: 'AWS/EC2',
        metricName: 'StatusCheckFailed_Instance',
        dimensions: { InstanceId: this.instance.id },
        statistic: 'Maximum',
        period: 60,
        evaluationPeriods: 3,
        threshold: 1,
        comparisonOperator: 'GreaterThanOrEqualToThreshold',
        treatMissingData: 'missing',
        alarmActions: [`arn:aws:automate:${awsRegion}:ec2:reboot`],
        tags,
      },
      { parent: this }
    );

    // System status check: the underlying host failed. Recovery moves the
    // same instance, disk and address onto healthy hardware.
    new aws.cloudwatch.MetricAlarm(
      `${name}-system-check`,
      {
        name: `${name}-system-check`,
        alarmDescription:
          'The db-migrator runner failed its system status check for 2 minutes; EC2 recovers it onto new hardware. See docs/runbooks/db-migrator-runner.md.',
        namespace: 'AWS/EC2',
        metricName: 'StatusCheckFailed_System',
        dimensions: { InstanceId: this.instance.id },
        statistic: 'Maximum',
        period: 60,
        evaluationPeriods: 2,
        threshold: 1,
        comparisonOperator: 'GreaterThanOrEqualToThreshold',
        treatMissingData: 'missing',
        alarmActions: [`arn:aws:automate:${awsRegion}:ec2:recover`],
        tags,
      },
      { parent: this }
    );

    this.registerOutputs({ instanceId: this.instance.id });
  }
}
