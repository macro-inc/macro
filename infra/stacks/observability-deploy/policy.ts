// The deploy workflow's permissions, as data so tests can check them against
// the calls the workflow makes (see ../observability/deploy/policy.test.ts).
export interface DeployPolicyInputs {
  account: string;
  region: string;
  imageBucket: string;
  importRole: string;
  smokeTag: string;
  smokeRoleArn: string;
  smokeSecretArn: string;
}

export interface Statement {
  Sid: string;
  Effect: 'Allow';
  Action: string | string[];
  Resource: string | string[];
  Condition?: Record<string, Record<string, string | string[]>>;
}

export function deployStatements({
  account,
  region,
  imageBucket,
  importRole,
  smokeTag,
  smokeRoleArn,
  smokeSecretArn,
}: DeployPolicyInputs): Statement[] {
  const ec2 = (resource: string) =>
    `arn:aws:ec2:${region}:${account}:${resource}`;
  const inRegion = { StringEquals: { 'aws:RequestedRegion': region } };
  const tagged = (...values: string[]) => ({
    StringEquals: {
      'aws:RequestedRegion': region,
      'aws:ResourceTag/project': values,
    },
  });
  return [
    // Reads for publishing, smoke boots, Pulumi's diff and health checks.
    {
      Sid: 'Read',
      Effect: 'Allow',
      Action: [
        'ec2:Describe*',
        'ec2:GetConsoleOutput',
        'ec2:GetInstanceMetadataDefaults',
        'ec2:GetEbsEncryptionByDefault',
        'ec2:GetEbsDefaultKmsKeyId',
        'elasticloadbalancing:Describe*',
        'cloudwatch:DescribeAlarms',
        'ssm:DescribeInstanceInformation',
        'ssm:GetCommandInvocation',
      ],
      Resource: '*',
      Condition: inRegion,
    },
    {
      Sid: 'ReadZone',
      Effect: 'Allow',
      Action: [
        'route53:ListHostedZones',
        'route53:ListHostedZonesByName',
        'route53:GetHostedZone',
        'route53:ListTagsForResource',
      ],
      Resource: '*',
    },
    {
      Sid: 'Preflight',
      Effect: 'Allow',
      Action: 'iam:SimulatePrincipalPolicy',
      Resource: `arn:aws:iam::${account}:role/macro-observability-deploy`,
    },
    // Publishing: upload the VHD and import it as a private AMI.
    {
      Sid: 'ImageBucket',
      Effect: 'Allow',
      Action: ['s3:GetBucketLocation', 's3:GetBucketPublicAccessBlock'],
      Resource: `arn:aws:s3:::${imageBucket}`,
    },
    {
      Sid: 'ImageUpload',
      Effect: 'Allow',
      Action: [
        's3:PutObject',
        's3:AbortMultipartUpload',
        's3:ListMultipartUploadParts',
      ],
      Resource: `arn:aws:s3:::${imageBucket}/macro-observability/*`,
    },
    {
      Sid: 'ImageImport',
      Effect: 'Allow',
      Action: ['ec2:ImportSnapshot', 'ec2:RegisterImage'],
      Resource: '*',
      Condition: inRegion,
    },
    {
      Sid: 'ImportRole',
      Effect: 'Allow',
      Action: 'iam:PassRole',
      Resource: `arn:aws:iam::${account}:role/${importRole}`,
    },
    // Tags on images and snapshots (smoke result, source keys), and on
    // instances and volumes as they are created.
    {
      Sid: 'TagImages',
      Effect: 'Allow',
      Action: 'ec2:CreateTags',
      Resource: [
        `arn:aws:ec2:${region}::image/*`,
        `arn:aws:ec2:${region}::snapshot/*`,
      ],
      Condition: inRegion,
    },
    {
      Sid: 'TagOnCreate',
      Effect: 'Allow',
      Action: 'ec2:CreateTags',
      Resource: [ec2('instance/*'), ec2('volume/*')],
      Condition: {
        StringEquals: {
          'aws:RequestedRegion': region,
          'ec2:CreateAction': ['RunInstances', 'CreateVolume'],
        },
      },
    },
    // Launch the replacement and smoke hosts; only tagged as this project.
    {
      Sid: 'LaunchTagged',
      Effect: 'Allow',
      Action: 'ec2:RunInstances',
      Resource: ec2('instance/*'),
      Condition: {
        StringEquals: {
          'aws:RequestedRegion': region,
          'aws:RequestTag/project': ['observability', smokeTag],
        },
      },
    },
    {
      Sid: 'LaunchFromImage',
      Effect: 'Allow',
      Action: 'ec2:RunInstances',
      Resource: `arn:aws:ec2:${region}::image/*`,
      Condition: tagged('observability'),
    },
    {
      Sid: 'LaunchInto',
      Effect: 'Allow',
      Action: 'ec2:RunInstances',
      Resource: [
        ec2('subnet/*'),
        ec2('security-group/*'),
        ec2('network-interface/*'),
        ec2('volume/*'),
      ],
      Condition: inRegion,
    },
    {
      Sid: 'HostRoles',
      Effect: 'Allow',
      Action: 'iam:PassRole',
      Resource: [
        `arn:aws:iam::${account}:role/observability-host-*`,
        smokeRoleArn,
      ],
      Condition: {
        StringEquals: { 'iam:PassedToService': 'ec2.amazonaws.com' },
      },
    },
    // Stop, detach and terminate the old host and the smoke host.
    {
      Sid: 'ManageHosts',
      Effect: 'Allow',
      Action: [
        'ec2:StopInstances',
        'ec2:TerminateInstances',
        'ec2:AttachVolume',
        'ec2:DetachVolume',
      ],
      Resource: [ec2('instance/*'), ec2('volume/*')],
      Condition: tagged('observability', smokeTag),
    },
    {
      Sid: 'SmokeVolumes',
      Effect: 'Allow',
      Action: 'ec2:CreateVolume',
      Resource: ec2('volume/*'),
      Condition: {
        StringEquals: {
          'aws:RequestedRegion': region,
          'aws:RequestTag/project': smokeTag,
        },
      },
    },
    {
      Sid: 'DeleteSmokeVolumes',
      Effect: 'Allow',
      Action: 'ec2:DeleteVolume',
      Resource: ec2('volume/*'),
      Condition: tagged(smokeTag),
    },
    {
      Sid: 'SmokeCheck',
      Effect: 'Allow',
      Action: 'ssm:SendCommand',
      Resource: ec2('instance/*'),
      Condition: {
        StringEquals: { 'aws:ResourceTag/project': smokeTag },
      },
    },
    {
      Sid: 'SmokeCheckDocument',
      Effect: 'Allow',
      Action: 'ssm:SendCommand',
      Resource: `arn:aws:ssm:${region}::document/AWS-RunShellScript`,
    },
    {
      Sid: 'SmokeSecret',
      Effect: 'Allow',
      Action: 'secretsmanager:PutSecretValue',
      Resource: smokeSecretArn,
    },
    // Re-point the load balancer and alarms at the new host.
    {
      Sid: 'Targets',
      Effect: 'Allow',
      Action: [
        'elasticloadbalancing:RegisterTargets',
        'elasticloadbalancing:DeregisterTargets',
      ],
      Resource: `arn:aws:elasticloadbalancing:${region}:${account}:targetgroup/observability-*`,
    },
    {
      Sid: 'Alarms',
      Effect: 'Allow',
      Action: ['cloudwatch:PutMetricAlarm', 'cloudwatch:ListTagsForResource'],
      Resource: `arn:aws:cloudwatch:${region}:${account}:alarm:observability-*`,
    },
  ];
}
