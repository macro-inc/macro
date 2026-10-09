import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { createNetwork } from './network';
import { renderUserData } from './render';
import {
  validateRegion,
  validateRegionalArn,
  validateSettings,
} from './settings';

const config = new pulumi.Config();
const stack = pulumi.getStack();
if (!['dev', 'prod'].includes(stack)) {
  throw new Error('Use the dev or prod stack to select a unique hostname');
}
const region = aws.config.requireRegion();
validateRegion(region);
const baseDomain = 'macro.com';
const suffix = stack === 'prod' ? '' : '-dev';
const grafanaHost = `grafana${suffix}.${baseDomain}`;
const otlpHost = `otlp${suffix}.${baseDomain}`;
const tags = { project: 'observability', environment: stack };
const durable = { protect: true, retainOnDelete: true };
const secretArn = config.require('secretArn');
const allowedEmails = config.requireObject<string[]>('allowedEmails');
const adminEmails = config.requireObject<string[]>('adminEmails');
const alarmTopicArn = config.require('alarmTopicArn');
// Built from this stack's pinned NixOS flake and published in Ohio.
const amiId = config.require('amiId');
if (!/^ami-[a-f0-9]+$/.test(amiId)) {
  throw new Error('amiId must identify the reviewed observability NixOS image');
}
// Validate operator input before registering any infrastructure resources.
validateSettings({
  region,
  grafanaHost,
  otlpHost,
  allowedEmails,
  adminEmails,
  secretArn,
  volumeId: 'vol-0',
  logsBucket: 'validate-logs',
  tracesBucket: 'validate-traces',
});
validateRegionalArn(alarmTopicArn, 'sns', region);
const vpc = createNetwork(region, tags);
const subnet = vpc.privateSubnet;
const subnetId = subnet.id;

// Route53 is global; issuance and use of the certificate are both in Ohio.
const zone = aws.route53.getZoneOutput({
  name: baseDomain,
  privateZone: false,
});
const certificate = new aws.acm.Certificate('observability', {
  domainName: grafanaHost,
  subjectAlternativeNames: [otlpHost],
  validationMethod: 'DNS',
  tags,
});
const validationRecords = [grafanaHost, otlpHost].map((hostname) => {
  const option = certificate.domainValidationOptions.apply((options) => {
    const match = options.find((entry) => entry.domainName === hostname);
    if (!match) throw new Error(`Missing ACM validation for ${hostname}`);
    return match;
  });
  return new aws.route53.Record(`observability-certificate-${hostname}`, {
    zoneId: zone.zoneId,
    name: option.resourceRecordName,
    type: option.resourceRecordType,
    records: [option.resourceRecordValue],
    ttl: 300,
  });
});
const validatedCertificate = new aws.acm.CertificateValidation(
  'observability',
  {
    certificateArn: certificate.arn,
    validationRecordFqdns: validationRecords.map((record) => record.fqdn),
  }
);

function telemetryBucket(name: string) {
  const bucket = new aws.s3.BucketV2(
    name,
    { forceDestroy: false, tags },
    durable
  );
  new aws.s3.BucketPublicAccessBlock(`${name}-private`, {
    bucket: bucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  });
  new aws.s3.BucketServerSideEncryptionConfigurationV2(`${name}-encryption`, {
    bucket: bucket.id,
    rules: [{ applyServerSideEncryptionByDefault: { sseAlgorithm: 'AES256' } }],
  });
  new aws.s3.BucketPolicy(`${name}-tls`, {
    bucket: bucket.id,
    policy: bucket.arn.apply((arn) =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Deny',
            Principal: '*',
            Action: 's3:*',
            Resource: [arn, `${arn}/*`],
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          },
        ],
      })
    ),
  });
  // Loki/Tempo own retention. Do not expire active blocks with S3 lifecycle.
  new aws.s3.BucketLifecycleConfigurationV2(`${name}-multipart`, {
    bucket: bucket.id,
    rules: [
      {
        id: 'abort-incomplete-uploads',
        status: 'Enabled',
        filter: { prefix: '' },
        abortIncompleteMultipartUpload: { daysAfterInitiation: 1 },
      },
    ],
  });
  return bucket;
}
const logs = telemetryBucket('observability-logs');
const traces = telemetryBucket('observability-traces');
const data = new aws.ebs.Volume(
  'observability-data',
  {
    availabilityZone: subnet.availabilityZone,
    type: 'gp3',
    size: 300,
    encrypted: true,
    snapshotId: config.get('dataSnapshotId'),
    tags: { ...tags, ObservabilityBackup: stack },
  },
  durable
);

const role = new aws.iam.Role('observability-host', {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: 'ec2.amazonaws.com',
  }),
  tags,
});
const ssm = new aws.iam.RolePolicyAttachment('observability-ssm', {
  role: role.name,
  policyArn: 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore',
});
const policy = new aws.iam.RolePolicy('observability-storage', {
  role: role.id,
  policy: pulumi.all([logs.arn, traces.arn]).apply((arns) =>
    JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: [
            's3:ListBucket',
            's3:GetBucketLocation',
            's3:ListBucketMultipartUploads',
          ],
          Resource: arns,
        },
        {
          Effect: 'Allow',
          Action: [
            's3:GetObject',
            's3:PutObject',
            's3:DeleteObject',
            's3:AbortMultipartUpload',
            's3:ListMultipartUploadParts',
          ],
          Resource: arns.map((arn) => `${arn}/*`),
        },
        {
          Effect: 'Allow',
          Action: ['secretsmanager:GetSecretValue'],
          Resource: secretArn,
        },
        {
          Effect: 'Allow',
          Action: ['cloudwatch:PutMetricData'],
          Resource: '*',
          Condition: {
            StringEquals: { 'cloudwatch:namespace': 'Macro/Observability' },
          },
        },
      ],
    })
  ),
});
const profile = new aws.iam.InstanceProfile('observability-host', {
  role: role.name,
});
const albSg = new aws.ec2.SecurityGroup('observability-alb', {
  vpcId: vpc.vpcId,
  description: 'Public HTTPS only',
  ingress: [
    { protocol: 'tcp', fromPort: 443, toPort: 443, cidrBlocks: ['0.0.0.0/0'] },
  ],
  tags,
});
const hostSg = new aws.ec2.SecurityGroup('observability-host', {
  vpcId: vpc.vpcId,
  description: 'Only the ALB can reach the proxy; administration via SSM',
  ingress: [
    {
      protocol: 'tcp',
      fromPort: 8080,
      toPort: 8080,
      securityGroups: [albSg.id],
    },
  ],
  egress: [
    { protocol: '-1', fromPort: 0, toPort: 0, cidrBlocks: ['0.0.0.0/0'] },
  ],
  tags,
});
new aws.ec2.SecurityGroupRule('observability-alb-to-host', {
  securityGroupId: albSg.id,
  type: 'egress',
  protocol: 'tcp',
  fromPort: 8080,
  toPort: 8080,
  sourceSecurityGroupId: hostSg.id,
});
const instance = new aws.ec2.Instance(
  'observability',
  {
    ami: amiId,
    instanceType: 'm7i.xlarge',
    subnetId,
    associatePublicIpAddress: false,
    vpcSecurityGroupIds: [hostSg.id],
    iamInstanceProfile: profile.name,
    metadataOptions: {
      httpEndpoint: 'enabled',
      httpTokens: 'required',
      httpPutResponseHopLimit: 2,
    },
    rootBlockDevice: {
      volumeType: 'gp3',
      volumeSize: 30,
      encrypted: true,
      deleteOnTermination: true,
    },
    userDataReplaceOnChange: true,
    userDataBase64: pulumi
      .all([data.id, logs.bucket, traces.bucket])
      .apply(([volumeId, logsBucket, tracesBucket]) =>
        renderUserData({
          region,
          grafanaHost,
          otlpHost,
          allowedEmails,
          adminEmails,
          secretArn,
          volumeId,
          logsBucket,
          tracesBucket,
        })
      ),
    tags,
  },
  { deleteBeforeReplace: true, dependsOn: [policy, ssm, ...vpc.privateReady] }
);
new aws.ec2.VolumeAttachment('observability-data', {
  deviceName: '/dev/sdf',
  volumeId: data.id,
  instanceId: instance.id,
  stopInstanceBeforeDetaching: true,
  forceDetach: false,
});

const alb = new aws.lb.LoadBalancer(
  'observability',
  {
    loadBalancerType: 'application',
    internal: false,
    subnets: vpc.publicSubnetIds,
    securityGroups: [albSg.id],
    dropInvalidHeaderFields: true,
    desyncMitigationMode: 'strictest',
    tags,
  },
  { dependsOn: vpc.publicReady }
);
const target = new aws.lb.TargetGroup('observability', {
  port: 8080,
  protocol: 'HTTP',
  targetType: 'instance',
  vpcId: vpc.vpcId,
  healthCheck: { path: '/healthz', matcher: '200', interval: 30 },
  deregistrationDelay: 30,
  tags,
});
new aws.lb.TargetGroupAttachment('observability', {
  targetGroupArn: target.arn,
  targetId: instance.id,
  port: 8080,
});
const listener = new aws.lb.Listener('observability-https', {
  loadBalancerArn: alb.arn,
  port: 443,
  protocol: 'HTTPS',
  certificateArn: validatedCertificate.certificateArn,
  sslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
  defaultActions: [
    {
      type: 'fixed-response',
      fixedResponse: { contentType: 'text/plain', statusCode: '404' },
    },
  ],
});
new aws.lb.ListenerRule('observability-hosts', {
  listenerArn: listener.arn,
  priority: 1,
  conditions: [{ hostHeader: { values: [grafanaHost, otlpHost] } }],
  actions: [{ type: 'forward', targetGroupArn: target.arn }],
});
for (const hostname of [grafanaHost, otlpHost]) {
  new aws.route53.Record(hostname, {
    zoneId: zone.zoneId,
    name: hostname,
    type: 'A',
    aliases: [
      { name: alb.dnsName, zoneId: alb.zoneId, evaluateTargetHealth: true },
    ],
  });
}

const backupRole = new aws.iam.Role('observability-snapshots', {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: 'dlm.amazonaws.com',
  }),
  tags,
});
const backupPolicy = new aws.iam.RolePolicyAttachment(
  'observability-snapshots',
  {
    role: backupRole.name,
    policyArn:
      'arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole',
  }
);
new aws.dlm.LifecyclePolicy(
  'observability-snapshots',
  {
    description: 'Daily crash-consistent data volume snapshots retained 7 days',
    executionRoleArn: backupRole.arn,
    state: 'ENABLED',
    policyDetails: {
      resourceTypes: ['VOLUME'],
      targetTags: { ObservabilityBackup: stack },
      schedules: [
        {
          name: 'daily',
          copyTags: true,
          createRule: { interval: 24, intervalUnit: 'HOURS', times: '04:00' },
          retainRule: { count: 7 },
        },
      ],
    },
    tags,
  },
  { dependsOn: [backupPolicy] }
);
const alarm = {
  comparisonOperator: 'GreaterThanThreshold',
  evaluationPeriods: 2,
  period: 60,
  statistic: 'Maximum',
  alarmActions: [alarmTopicArn],
  okActions: [alarmTopicArn],
  tags,
};
new aws.cloudwatch.MetricAlarm('observability-instance', {
  ...alarm,
  namespace: 'AWS/EC2',
  metricName: 'StatusCheckFailed',
  threshold: 0,
  dimensions: { InstanceId: instance.id },
  treatMissingData: 'breaching',
});
new aws.cloudwatch.MetricAlarm('observability-ui', {
  ...alarm,
  namespace: 'AWS/ApplicationELB',
  metricName: 'UnHealthyHostCount',
  threshold: 0,
  dimensions: { LoadBalancer: alb.arnSuffix, TargetGroup: target.arnSuffix },
  treatMissingData: 'breaching',
});
for (const [name, path] of [
  ['observability-disk', '/srv/observability'],
  ['observability-root-disk', '/'],
]) {
  new aws.cloudwatch.MetricAlarm(name, {
    ...alarm,
    namespace: 'Macro/Observability',
    metricName: 'disk_used_percent',
    threshold: 80,
    dimensions: { InstanceId: instance.id, path, fstype: 'ext4' },
    period: 300,
    treatMissingData: 'breaching',
  });
}
new aws.cloudwatch.MetricAlarm('observability-memory', {
  ...alarm,
  namespace: 'Macro/Observability',
  metricName: 'mem_used_percent',
  threshold: 90,
  dimensions: { InstanceId: instance.id },
  period: 300,
  treatMissingData: 'breaching',
});

export const grafanaUrl = `https://${grafanaHost}`;
export const otlpHttpEndpoint = `https://${otlpHost}`;
export const instanceId = instance.id;
export const dataVolumeId = data.id;
export const logsBucket = logs.bucket;
export const tracesBucket = traces.bucket;
export const observabilityRegion = region;
