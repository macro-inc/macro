// Hosted OpenBao for Passwords, dev only. See AGENTS.md and README.md.
import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import {
  DATADOG_API_KEY,
  DEFAULT_CONTINUE_BEFORE_STEADY_STATE,
  DEFAULT_TARGET_GROUP_HEALTH_CHECK,
  EcsDeploymentFailureAlarm,
  withTelemetry,
} from '../../packages/resources';
import { cloudStorageClusterArn } from '../../packages/service/src/cluster';
import {
  CLOUD_TRAIL_SNS_TOPIC_ARN,
  grafanaIngestSecretArn,
  stack,
} from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { API_PORT, DATA_MOUNT_PATH, renderServerConfig } from './server-config';

if (stack !== 'dev') {
  throw new Error('Hosted OpenBao is dev-only; prod is a separate design');
}
const region = aws.config.requireRegion();

const BASE_NAME = pulumi.getProject();
// Upstream 2.7.2 (the local stack's version), pinned by digest and pulled
// from Quay rather than Docker Hub. No custom image: config arrives as
// BAO_LOCAL_CONFIG.
const IMAGE =
  'quay.io/openbao/openbao:2.7.2@sha256:5046911075e137e154ce49ab051502f4ec7cf367d484ae4a4dce665d9b90561f';
// The `openbao` user in that image.
const OPENBAO_UID = 100;
const OPENBAO_GID = 1000;
const HOSTNAME = 'openbao-dev.macro-internal.com';
const API_ADDRESS = `https://${HOSTNAME}`;
const HTTPS_PORT = 443;
const NFS_PORT = 2049;

// The Raft directory on EFS. A restore points this at the restored copy
// (README "Restore"); changing it replaces the access point.
const DATA_DIRECTORY = new pulumi.Config().get('dataDirectory') ?? '/openbao';

const tags = { project: BASE_NAME, environment: stack, tech_lead: 'wolf' };
const durable = { protect: true, retainOnDelete: true };
const vpc = get_coparse_api_vpc();

// Only the document storage service (which hosts Passwords) may call the vault.
const cloudStorageService = new pulumi.StackReference('cloud-storage-service', {
  name: `macro-inc/cloud-storage-service/${stack}`,
});
const documentStorageSecurityGroupId = cloudStorageService.requireOutput(
  'cloudStorageServiceSgId'
) as pulumi.Output<string>;

// --- Task role and seal key -------------------------------------------------

const taskRole = new aws.iam.Role(`${BASE_NAME}-task-role`, {
  name: `${BASE_NAME}-task-role-${stack}`,
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: 'ecs-tasks.amazonaws.com',
  }),
  tags,
});
const executionRole = new aws.iam.Role(`${BASE_NAME}-execution-role`, {
  name: `${BASE_NAME}-execution-role-${stack}`,
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: 'ecs-tasks.amazonaws.com',
  }),
  managedPolicyArns: [
    'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
  ],
  tags,
});

// The vault needs no app config, so there is no Doppler environment; the dev
// Grafana sidecar from withTelemetry still reads its ingest token.
if (grafanaIngestSecretArn) {
  new aws.iam.RolePolicy(`${BASE_NAME}-execution-secrets`, {
    role: executionRole.id,
    policy: {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: 'secretsmanager:GetSecretValue',
          Resource: grafanaIngestSecretArn,
        },
      ],
    },
  });
}

const SEAL_ACTIONS = ['kms:Encrypt', 'kms:Decrypt', 'kms:DescribeKey'];
const accountRootArn = pulumi.interpolate`arn:aws:iam::${aws.getCallerIdentityOutput().accountId}:root`;
const sealKey = new aws.kms.Key(
  `${BASE_NAME}-seal-key`,
  {
    description: `OpenBao auto-unseal for ${stack}`,
    deletionWindowInDays: 30,
    enableKeyRotation: true,
    policy: aws.iam.getPolicyDocumentOutput({
      statements: [
        {
          sid: 'AllowAccountKeyAdministration',
          effect: 'Allow',
          principals: [{ type: 'AWS', identifiers: [accountRootArn] }],
          actions: [
            'kms:CancelKeyDeletion',
            'kms:Create*',
            'kms:Delete*',
            'kms:Describe*',
            'kms:Disable*',
            'kms:Enable*',
            'kms:Get*',
            'kms:List*',
            'kms:Put*',
            'kms:Revoke*',
            'kms:ScheduleKeyDeletion',
            'kms:TagResource',
            'kms:UntagResource',
            'kms:Update*',
          ],
          resources: ['*'],
        },
        // The only grant: the account root has no data-plane actions, so
        // IAM policies cannot widen use of this key.
        {
          sid: 'AllowOpenBaoSeal',
          effect: 'Allow',
          principals: [{ type: 'AWS', identifiers: [taskRole.arn] }],
          actions: SEAL_ACTIONS,
          resources: ['*'],
        },
      ],
    }).json,
    tags,
  },
  // Losing this key makes the Raft data unrecoverable.
  durable
);
new aws.kms.Alias(`${BASE_NAME}-seal-key-alias`, {
  name: `alias/${BASE_NAME}-${stack}`,
  targetKeyId: sealKey.keyId,
});
// ECS Exec: the one-time `bao operator init` and the operator tunnel.
new aws.iam.RolePolicy(`${BASE_NAME}-exec`, {
  role: taskRole.id,
  policy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: [
          'ssmmessages:CreateControlChannel',
          'ssmmessages:CreateDataChannel',
          'ssmmessages:OpenControlChannel',
          'ssmmessages:OpenDataChannel',
        ],
        Resource: '*',
      },
    ],
  },
});

// --- Security groups ------------------------------------------------------

const loadBalancerSecurityGroup = new aws.ec2.SecurityGroup(
  `${BASE_NAME}-alb-sg`,
  {
    name: `${BASE_NAME}-alb-sg-${stack}`,
    vpcId: vpc.vpcId,
    description:
      'OpenBao internal ALB: HTTPS from the document storage service',
    tags,
  }
);
const taskSecurityGroup = new aws.ec2.SecurityGroup(`${BASE_NAME}-task-sg`, {
  name: `${BASE_NAME}-task-sg-${stack}`,
  vpcId: vpc.vpcId,
  description: 'OpenBao task: API from its ALB only',
  tags,
});
const fileSystemSecurityGroup = new aws.ec2.SecurityGroup(
  `${BASE_NAME}-efs-sg`,
  {
    name: `${BASE_NAME}-efs-sg-${stack}`,
    vpcId: vpc.vpcId,
    description: 'OpenBao Raft volume: NFS from the OpenBao task only',
    tags,
  }
);

new aws.vpc.SecurityGroupIngressRule(`${BASE_NAME}-alb-in-dss`, {
  securityGroupId: loadBalancerSecurityGroup.id,
  description: 'HTTPS from the document storage service',
  referencedSecurityGroupId: documentStorageSecurityGroupId,
  ipProtocol: 'tcp',
  fromPort: HTTPS_PORT,
  toPort: HTTPS_PORT,
  tags,
});
// The operator tunnel: an SSM port-forward runs inside the OpenBao task and
// reaches the ALB from there, so operators get the verified HTTPS origin
// (README "Operator tunnel"). The task already serves the API itself.
new aws.vpc.SecurityGroupIngressRule(`${BASE_NAME}-alb-in-task`, {
  securityGroupId: loadBalancerSecurityGroup.id,
  description: 'HTTPS from the OpenBao task (operator SSM tunnel)',
  referencedSecurityGroupId: taskSecurityGroup.id,
  ipProtocol: 'tcp',
  fromPort: HTTPS_PORT,
  toPort: HTTPS_PORT,
  tags,
});
new aws.vpc.SecurityGroupEgressRule(`${BASE_NAME}-alb-out-task`, {
  securityGroupId: loadBalancerSecurityGroup.id,
  description: 'OpenBao API',
  referencedSecurityGroupId: taskSecurityGroup.id,
  ipProtocol: 'tcp',
  fromPort: API_PORT,
  toPort: API_PORT,
  tags,
});
const taskIngress = new aws.vpc.SecurityGroupIngressRule(
  `${BASE_NAME}-task-in-alb`,
  {
    securityGroupId: taskSecurityGroup.id,
    description: 'OpenBao API from the ALB',
    referencedSecurityGroupId: loadBalancerSecurityGroup.id,
    ipProtocol: 'tcp',
    fromPort: API_PORT,
    toPort: API_PORT,
    tags,
  }
);
// KMS, Quay, the seal plugin's registry (ghcr.io), SSM, and the Datadog
// intake are all HTTPS.
const taskHttpsEgress = new aws.vpc.SecurityGroupEgressRule(
  `${BASE_NAME}-task-https-out`,
  {
    securityGroupId: taskSecurityGroup.id,
    description: 'HTTPS to AWS APIs, the image registry, and Datadog',
    cidrIpv4: '0.0.0.0/0',
    ipProtocol: 'tcp',
    fromPort: HTTPS_PORT,
    toPort: HTTPS_PORT,
    tags,
  }
);
const taskNfsEgress = new aws.vpc.SecurityGroupEgressRule(
  `${BASE_NAME}-task-nfs-out`,
  {
    securityGroupId: taskSecurityGroup.id,
    description: 'NFS to the Raft volume',
    referencedSecurityGroupId: fileSystemSecurityGroup.id,
    ipProtocol: 'tcp',
    fromPort: NFS_PORT,
    toPort: NFS_PORT,
    tags,
  }
);
const efsIngress = new aws.vpc.SecurityGroupIngressRule(
  `${BASE_NAME}-efs-in-task`,
  {
    securityGroupId: fileSystemSecurityGroup.id,
    description: 'NFS from the OpenBao task',
    referencedSecurityGroupId: taskSecurityGroup.id,
    ipProtocol: 'tcp',
    fromPort: NFS_PORT,
    toPort: NFS_PORT,
    tags,
  }
);

// --- Raft volume and backup -------------------------------------------------

// EFS is the only durable volume Fargate mounts. One node, low traffic: fine
// for dev; prod moves to EBS-backed HA Raft (see README).
const fileSystem = new aws.efs.FileSystem(
  `${BASE_NAME}-data`,
  {
    encrypted: true,
    throughputMode: 'elastic',
    tags: { ...tags, Name: `${BASE_NAME}-data-${stack}` },
  },
  durable
);
const mountTargets = vpc.privateSubnetIds.map(
  (subnetId, index) =>
    new aws.efs.MountTarget(`${BASE_NAME}-data-${index}`, {
      fileSystemId: fileSystem.id,
      subnetId,
      securityGroups: [fileSystemSecurityGroup.id],
    })
);
const accessPoint = new aws.efs.AccessPoint(`${BASE_NAME}-data`, {
  fileSystemId: fileSystem.id,
  posixUser: { uid: OPENBAO_UID, gid: OPENBAO_GID },
  rootDirectory: {
    path: DATA_DIRECTORY,
    creationInfo: {
      ownerUid: OPENBAO_UID,
      ownerGid: OPENBAO_GID,
      permissions: '700',
    },
  },
  tags,
});
new aws.efs.FileSystemPolicy(`${BASE_NAME}-data`, {
  fileSystemId: fileSystem.id,
  policy: pulumi.jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'TaskRoleThroughAccessPointOverTls',
        Effect: 'Allow',
        Principal: { AWS: taskRole.arn },
        Action: [
          'elasticfilesystem:ClientMount',
          'elasticfilesystem:ClientWrite',
        ],
        Resource: fileSystem.arn,
        Condition: {
          Bool: { 'aws:SecureTransport': 'true' },
          StringEquals: { 'elasticfilesystem:AccessPointArn': accessPoint.arn },
        },
      },
    ],
  }),
});

const backupVault = new aws.backup.Vault(
  `${BASE_NAME}-backup`,
  { name: `${BASE_NAME}-${stack}`, tags },
  durable
);
const backupPlan = new aws.backup.Plan(`${BASE_NAME}-backup`, {
  name: `${BASE_NAME}-${stack}`,
  rules: [
    {
      ruleName: 'daily',
      targetVaultName: backupVault.name,
      schedule: 'cron(0 5 * * ? *)',
      lifecycle: { deleteAfter: 14 },
    },
  ],
  tags,
});
const backupRole = new aws.iam.Role(`${BASE_NAME}-backup-role`, {
  name: `${BASE_NAME}-backup-role-${stack}`,
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: 'backup.amazonaws.com',
  }),
  managedPolicyArns: [
    'arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup',
    'arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores',
  ],
  tags,
});
new aws.backup.Selection(`${BASE_NAME}-backup`, {
  name: `${BASE_NAME}-data`,
  planId: backupPlan.id,
  iamRoleArn: backupRole.arn,
  resources: [fileSystem.arn],
});

// --- TLS, DNS, and the internal ALB ----------------------------------------

const zone = aws.route53.getZoneOutput({
  name: 'macro-internal.com',
  privateZone: false,
});
const certificate = new aws.acm.Certificate(`${BASE_NAME}-certificate`, {
  domainName: HOSTNAME,
  validationMethod: 'DNS',
  tags,
});
const validation = certificate.domainValidationOptions[0];
const validationRecord = new aws.route53.Record(
  `${BASE_NAME}-certificate-validation`,
  {
    zoneId: zone.zoneId,
    name: validation.resourceRecordName,
    type: validation.resourceRecordType,
    records: [validation.resourceRecordValue],
    ttl: 300,
  }
);
const validatedCertificate = new aws.acm.CertificateValidation(
  `${BASE_NAME}-certificate`,
  {
    certificateArn: certificate.arn,
    validationRecordFqdns: [validationRecord.fqdn],
  }
);

// Not the public gateway: the vault API must never be reachable from outside
// the VPC, so it gets its own internal ALB.
const loadBalancer = new aws.lb.LoadBalancer(`${BASE_NAME}-alb`, {
  name: `${BASE_NAME}-${stack}`,
  internal: true,
  loadBalancerType: 'application',
  subnets: vpc.privateSubnetIds,
  securityGroups: [loadBalancerSecurityGroup.id],
  dropInvalidHeaderFields: true,
  // Longer than the server's 90 s default_max_request_duration.
  idleTimeout: 95,
  tags,
});
const targetGroup = new aws.lb.TargetGroup(`${BASE_NAME}-tg`, {
  name: `${BASE_NAME}-${stack}-tg`,
  vpcId: vpc.vpcId,
  targetType: 'ip',
  protocol: 'HTTP',
  port: API_PORT,
  // Below the shared 15 s default: the old task drains before the new one
  // starts (stop-then-start), so every second here is outage.
  deregistrationDelay: 5,
  healthCheck: {
    ...DEFAULT_TARGET_GROUP_HEALTH_CHECK,
    // ALB matchers stop at 499, so uninitialized (the first deploy, before
    // `operator init`) answers 200 instead of 501. Sealed (503) stays
    // unhealthy, so ECS replaces the task.
    path: '/v1/sys/health?uninitcode=200',
    matcher: '200',
  },
  tags,
});
const listener = new aws.lb.Listener(`${BASE_NAME}-https`, {
  loadBalancerArn: loadBalancer.arn,
  port: HTTPS_PORT,
  protocol: 'HTTPS',
  sslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
  certificateArn: validatedCertificate.certificateArn,
  defaultActions: [{ type: 'forward', targetGroupArn: targetGroup.arn }],
  tags,
});
new aws.route53.Record(`${BASE_NAME}-dns`, {
  zoneId: zone.zoneId,
  name: HOSTNAME,
  type: 'A',
  aliases: [
    {
      name: loadBalancer.dnsName,
      zoneId: loadBalancer.zoneId,
      evaluateTargetHealth: false,
    },
  ],
});

// --- Service ------------------------------------------------------------------

const serverConfig = sealKey.arn.apply((sealKeyArn) =>
  renderServerConfig({ apiAddress: API_ADDRESS, region, sealKeyArn })
);

const service = new awsx.ecs.FargateService(
  BASE_NAME,
  {
    name: BASE_NAME,
    cluster: cloudStorageClusterArn,
    desiredCount: 1,
    // Raft data must never be open in two tasks: stop the old one first.
    deploymentMinimumHealthyPercent: 0,
    deploymentMaximumPercent: 100,
    continueBeforeSteadyState: DEFAULT_CONTINUE_BEFORE_STEADY_STATE,
    deploymentCircuitBreaker: { enable: true, rollback: true },
    enableExecuteCommand: true,
    networkConfiguration: {
      subnets: vpc.privateSubnetIds,
      securityGroups: [taskSecurityGroup.id],
      assignPublicIp: false,
    },
    loadBalancers: [
      {
        targetGroupArn: targetGroup.arn,
        containerName: 'openbao',
        containerPort: API_PORT,
      },
    ],
    taskDefinitionArgs: {
      // Logs go through FireLens; awsx's default log group would stay empty.
      logGroup: { skip: true },
      cpu: '512',
      memory: '1024',
      taskRole: { roleArn: taskRole.arn },
      executionRole: { roleArn: executionRole.arn },
      runtimePlatform: {
        operatingSystemFamily: 'LINUX',
        cpuArchitecture: 'X86_64',
      },
      volumes: [
        {
          name: 'data',
          efsVolumeConfiguration: {
            fileSystemId: fileSystem.id,
            transitEncryption: 'ENABLED',
            authorizationConfig: {
              accessPointId: accessPoint.id,
              iam: 'ENABLED',
            },
          },
        },
      ],
      containers: withTelemetry(BASE_NAME, {
        openbao: {
          name: 'openbao',
          image: IMAGE,
          essential: true,
          command: ['server'],
          dependsOn: [{ containerName: 'log_router', condition: 'START' }],
          environment: [
            { name: 'BAO_LOCAL_CONFIG', value: serverConfig },
            // The access point already owns the volume as `openbao`.
            { name: 'SKIP_CHOWN', value: 'true' },
          ],
          portMappings: [{ containerPort: API_PORT, hostPort: API_PORT }],
          mountPoints: [
            { sourceVolume: 'data', containerPath: DATA_MOUNT_PATH },
          ],
          linuxParameters: { initProcessEnabled: true },
          logConfiguration: {
            logDriver: 'awsfirelens',
            options: {
              Name: 'datadog',
              Host: 'http-intake.logs.us5.datadoghq.com',
              // Egress allows only 443; Fluent Bit defaults to plain 80.
              TLS: 'on',
              Port: String(HTTPS_PORT),
              apikey: DATADOG_API_KEY,
              dd_service: BASE_NAME,
              dd_source: 'openbao',
              dd_tags: `env:${stack}`,
              provider: 'ecs',
            },
          },
        },
      }),
    },
    tags,
  },
  {
    dependsOn: [
      listener,
      taskIngress,
      taskHttpsEgress,
      taskNfsEgress,
      efsIngress,
      ...mountTargets,
    ],
  }
);

// --- Alarms -------------------------------------------------------------------

new EcsDeploymentFailureAlarm(`${BASE_NAME}-deployment-failure-alarm`, {
  serviceName: BASE_NAME,
  serviceArn: service.service.arn,
  tags,
});
new aws.cloudwatch.MetricAlarm(`${BASE_NAME}-unhealthy-alarm`, {
  name: `${BASE_NAME}-unhealthy-${stack}`,
  namespace: 'AWS/ApplicationELB',
  metricName: 'HealthyHostCount',
  statistic: 'Minimum',
  period: 60,
  evaluationPeriods: 5,
  threshold: 1,
  comparisonOperator: 'LessThanThreshold',
  treatMissingData: 'breaching',
  dimensions: {
    LoadBalancer: loadBalancer.arnSuffix,
    TargetGroup: targetGroup.arnSuffix,
  },
  alarmDescription:
    'OpenBao has no healthy task (healthy means active, or not yet initialized).',
  alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
  okActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
  tags,
});

export const address = API_ADDRESS;
export const serviceName = service.service.name;
export const sealKeyArn = sealKey.arn;
export const fileSystemId = fileSystem.id;
export const fileSystemArn = fileSystem.arn;
export const backupRoleArn = backupRole.arn;
export const backupVaultName = backupVault.name;
