// The dev vault in the OpenBao AWS account, beside the legacy one in index.ts.
// Everything here uses the OpenBao account's provider except the pieces DSS
// needs in the main account: the PrivateLink endpoint in the shared VPC, the
// certificate's validation record, and the CloudWatch Logs destination that
// feeds the shared Datadog Firehose.
import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import {
  DEFAULT_CONTINUE_BEFORE_STEADY_STATE,
  DEFAULT_TARGET_GROUP_HEALTH_CHECK,
  EcsDeploymentFailureAlarm,
} from '../../packages/resources';
import { EcrImage } from '../../packages/service';
import {
  CLOUDWATCH_KINESIS_STREAM_ROLE_ARN,
  DATADOG_KINESIS_FIREHOSE_STREAM_ARN,
  stack,
} from '../../packages/shared';
import { coparse_api_vpc_filtered_subnets } from '../../packages/vpc';
import {
  API_ADDRESS,
  BASE_NAME,
  DURABLE,
  HOSTNAME,
  HTTPS_PORT,
  NFS_PORT,
  OPENBAO_GID,
  OPENBAO_UID,
  TAGS,
} from './constants';
import { createNetwork, ZONES } from './network';
import { API_PORT, DATA_MOUNT_PATH, renderServerConfig } from './server-config';

/** `macro-openbao`, the account that holds dev and prod OpenBao. */
const OPENBAO_ACCOUNT_ID = '169344408001';
/**
 * Every IAM role here lives under this path with this boundary; the deploy role
 * may create no other (the account bootstrap's `openbao-deploy-<env>`).
 */
const ROLE_PATH = `/openbao/${stack}/`;
const PERMISSIONS_BOUNDARY = `arn:aws:iam::${OPENBAO_ACCOUNT_ID}:policy/openbao-boundary-${stack}`;
/** The Raft directory on the fresh volume (the legacy one is configurable). */
const DATA_DIRECTORY = '/openbao';

export function createAccountVault(args: {
  region: string;
  /** Only this security group may reach the vault's PrivateLink endpoint. */
  documentStorageSecurityGroupId: pulumi.Input<string>;
  sharedVpcId: string;
  /** The main account's `macro-internal.com` zone. */
  zoneId: pulumi.Input<string>;
}) {
  const { region, documentStorageSecurityGroupId, sharedVpcId, zoneId } = args;
  const name = `${BASE_NAME}-account`;
  const tags = TAGS;

  // Pulumi runs with main-account credentials and assumes the OpenBao account's
  // deploy role (`openbao:deployRoleArn`) for everything on the vault side.
  const provider = new aws.Provider(name, {
    region: region as aws.Region,
    allowedAccountIds: [OPENBAO_ACCOUNT_ID],
    // The deploy roles deny touching anything tagged for the other environment.
    defaultTags: { tags: { 'openbao:env': stack } },
    assumeRoles: [
      {
        roleArn: new pulumi.Config().require('deployRoleArn'),
        sessionName: `pulumi-${BASE_NAME}-${stack}`,
      },
    ],
  });
  const inAccount = { provider };
  const mainAccountId = aws.getCallerIdentityOutput().accountId;
  const accountRootArn = `arn:aws:iam::${OPENBAO_ACCOUNT_ID}:root`;

  const network = createNetwork({
    name: `${BASE_NAME}-${stack}`,
    region,
    accountId: OPENBAO_ACCOUNT_ID,
    tags,
    provider,
  });

  // --- Roles and seal key ----------------------------------------------------

  const taskRole = new aws.iam.Role(
    `${name}-task-role`,
    {
      name: `${BASE_NAME}-task-role-${stack}`,
      path: ROLE_PATH,
      permissionsBoundary: PERMISSIONS_BOUNDARY,
      assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
        Service: 'ecs-tasks.amazonaws.com',
      }),
      tags,
    },
    inAccount
  );
  const executionRole = new aws.iam.Role(
    `${name}-execution-role`,
    {
      name: `${BASE_NAME}-execution-role-${stack}`,
      path: ROLE_PATH,
      permissionsBoundary: PERMISSIONS_BOUNDARY,
      assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
        Service: 'ecs-tasks.amazonaws.com',
      }),
      managedPolicyArns: [
        'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
      ],
      tags,
    },
    inAccount
  );
  const sealKey = new aws.kms.Key(
    `${name}-seal-key`,
    {
      description: `OpenBao auto-unseal for ${stack}`,
      deletionWindowInDays: 30,
      enableKeyRotation: true,
      policy: aws.iam.getPolicyDocumentOutput(
        {
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
              actions: ['kms:Encrypt', 'kms:Decrypt', 'kms:DescribeKey'],
              resources: ['*'],
            },
          ],
        },
        inAccount
      ).json,
      tags,
    },
    // Losing this key makes the Raft data unrecoverable.
    { ...inAccount, ...DURABLE }
  );
  new aws.kms.Alias(
    `${name}-seal-key-alias`,
    { name: `alias/${BASE_NAME}-${stack}`, targetKeyId: sealKey.keyId },
    inAccount
  );
  // ECS Exec: the one-time `bao operator init` and the operator tunnel.
  new aws.iam.RolePolicy(
    `${name}-exec`,
    {
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
    },
    inAccount
  );

  // --- Security groups --------------------------------------------------------

  const loadBalancerSecurityGroup = new aws.ec2.SecurityGroup(
    `${name}-nlb-sg`,
    {
      name: `${BASE_NAME}-nlb-sg-${stack}`,
      vpcId: network.vpcId,
      description: 'OpenBao NLB: PrivateLink from DSS, HTTPS from the task',
      tags,
    },
    inAccount
  );
  const taskSecurityGroup = new aws.ec2.SecurityGroup(
    `${name}-task-sg`,
    {
      name: `${BASE_NAME}-task-sg-${stack}`,
      vpcId: network.vpcId,
      description: 'OpenBao task: API from its NLB only',
      tags,
    },
    inAccount
  );
  const fileSystemSecurityGroup = new aws.ec2.SecurityGroup(
    `${name}-efs-sg`,
    {
      name: `${BASE_NAME}-efs-sg-${stack}`,
      vpcId: network.vpcId,
      description: 'OpenBao Raft volume: NFS from the OpenBao task only',
      tags,
    },
    inAccount
  );
  // In the main account's shared VPC: the PrivateLink endpoint DSS calls.
  const consumerEndpointSecurityGroup = new aws.ec2.SecurityGroup(
    `${name}-consumer-sg`,
    {
      name: `${BASE_NAME}-consumer-sg-${stack}`,
      vpcId: sharedVpcId,
      description: 'OpenBao PrivateLink endpoint: HTTPS from DSS only',
      tags,
    }
  );

  new aws.vpc.SecurityGroupIngressRule(`${name}-consumer-in-dss`, {
    securityGroupId: consumerEndpointSecurityGroup.id,
    description: 'HTTPS from the document storage service',
    referencedSecurityGroupId: documentStorageSecurityGroupId,
    ipProtocol: 'tcp',
    fromPort: HTTPS_PORT,
    toPort: HTTPS_PORT,
    tags,
  });
  // PrivateLink traffic arrives from the NLB's own addresses, so the consumer
  // endpoint's security group above is what admits DSS (the NLB skips its
  // inbound rules for PrivateLink traffic). This rule is the operator tunnel: an
  // SSM port-forward runs inside the task and reaches the NLB from there.
  new aws.vpc.SecurityGroupIngressRule(
    `${name}-nlb-in-task`,
    {
      securityGroupId: loadBalancerSecurityGroup.id,
      description: 'HTTPS from the OpenBao task (operator SSM tunnel)',
      referencedSecurityGroupId: taskSecurityGroup.id,
      ipProtocol: 'tcp',
      fromPort: HTTPS_PORT,
      toPort: HTTPS_PORT,
      tags,
    },
    inAccount
  );
  new aws.vpc.SecurityGroupEgressRule(
    `${name}-nlb-out-task`,
    {
      securityGroupId: loadBalancerSecurityGroup.id,
      description: 'OpenBao API and health checks',
      referencedSecurityGroupId: taskSecurityGroup.id,
      ipProtocol: 'tcp',
      fromPort: API_PORT,
      toPort: API_PORT,
      tags,
    },
    inAccount
  );
  const taskIngress = new aws.vpc.SecurityGroupIngressRule(
    `${name}-task-in-nlb`,
    {
      securityGroupId: taskSecurityGroup.id,
      description: 'OpenBao API from the NLB',
      referencedSecurityGroupId: loadBalancerSecurityGroup.id,
      ipProtocol: 'tcp',
      fromPort: API_PORT,
      toPort: API_PORT,
      tags,
    },
    inAccount
  );
  // No 0.0.0.0/0: the task reaches only the AWS endpoints, S3 (image layers),
  // its EFS, and its own NLB (the operator tunnel).
  const taskEgress = [
    new aws.vpc.SecurityGroupEgressRule(
      `${name}-task-endpoints-out`,
      {
        securityGroupId: taskSecurityGroup.id,
        description:
          'HTTPS to the AWS interface endpoints (ECR, Logs, KMS, SSM)',
        referencedSecurityGroupId: network.endpointSecurityGroupId,
        ipProtocol: 'tcp',
        fromPort: HTTPS_PORT,
        toPort: HTTPS_PORT,
        tags,
      },
      inAccount
    ),
    new aws.vpc.SecurityGroupEgressRule(
      `${name}-task-s3-out`,
      {
        securityGroupId: taskSecurityGroup.id,
        description:
          'HTTPS to S3 through the gateway endpoint (ECR image layers)',
        prefixListId: network.s3PrefixListId,
        ipProtocol: 'tcp',
        fromPort: HTTPS_PORT,
        toPort: HTTPS_PORT,
        tags,
      },
      inAccount
    ),
    new aws.vpc.SecurityGroupEgressRule(
      `${name}-task-nlb-out`,
      {
        securityGroupId: taskSecurityGroup.id,
        description: 'HTTPS to its own NLB (operator SSM tunnel)',
        referencedSecurityGroupId: loadBalancerSecurityGroup.id,
        ipProtocol: 'tcp',
        fromPort: HTTPS_PORT,
        toPort: HTTPS_PORT,
        tags,
      },
      inAccount
    ),
    new aws.vpc.SecurityGroupEgressRule(
      `${name}-task-nfs-out`,
      {
        securityGroupId: taskSecurityGroup.id,
        description: 'NFS to the Raft volume',
        referencedSecurityGroupId: fileSystemSecurityGroup.id,
        ipProtocol: 'tcp',
        fromPort: NFS_PORT,
        toPort: NFS_PORT,
        tags,
      },
      inAccount
    ),
  ];
  const endpointIngress = new aws.vpc.SecurityGroupIngressRule(
    `${name}-endpoints-in-task`,
    {
      securityGroupId: network.endpointSecurityGroupId,
      description: 'HTTPS from the OpenBao task',
      referencedSecurityGroupId: taskSecurityGroup.id,
      ipProtocol: 'tcp',
      fromPort: HTTPS_PORT,
      toPort: HTTPS_PORT,
      tags,
    },
    inAccount
  );
  const efsIngress = new aws.vpc.SecurityGroupIngressRule(
    `${name}-efs-in-task`,
    {
      securityGroupId: fileSystemSecurityGroup.id,
      description: 'NFS from the OpenBao task',
      referencedSecurityGroupId: taskSecurityGroup.id,
      ipProtocol: 'tcp',
      fromPort: NFS_PORT,
      toPort: NFS_PORT,
      tags,
    },
    inAccount
  );

  // --- Raft volume and backup -------------------------------------------------

  // A fresh volume: the legacy one can't move accounts, and its data is copied
  // over the API instead (README "Moving the vault to the OpenBao account").
  const fileSystem = new aws.efs.FileSystem(
    `${name}-data`,
    {
      encrypted: true,
      throughputMode: 'elastic',
      tags: { ...tags, Name: `${BASE_NAME}-data-${stack}` },
    },
    { ...inAccount, ...DURABLE }
  );
  const mountTargets = network.subnetIds.map(
    (subnetId, index) =>
      new aws.efs.MountTarget(
        `${name}-data-${ZONES[index].zoneId}`,
        {
          fileSystemId: fileSystem.id,
          subnetId,
          securityGroups: [fileSystemSecurityGroup.id],
        },
        inAccount
      )
  );
  const accessPoint = new aws.efs.AccessPoint(
    `${name}-data`,
    {
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
    },
    inAccount
  );
  new aws.efs.FileSystemPolicy(
    `${name}-data`,
    {
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
              StringEquals: {
                'elasticfilesystem:AccessPointArn': accessPoint.arn,
              },
            },
          },
        ],
      }),
    },
    inAccount
  );

  const backupVault = new aws.backup.Vault(
    `${name}-backup`,
    { name: `${BASE_NAME}-${stack}`, tags },
    { ...inAccount, ...DURABLE }
  );
  const backupPlan = new aws.backup.Plan(
    `${name}-backup`,
    {
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
    },
    inAccount
  );
  const backupRole = new aws.iam.Role(
    `${name}-backup-role`,
    {
      name: `${BASE_NAME}-backup-role-${stack}`,
      path: ROLE_PATH,
      permissionsBoundary: PERMISSIONS_BOUNDARY,
      assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
        Service: 'backup.amazonaws.com',
      }),
      managedPolicyArns: [
        'arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup',
        'arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores',
      ],
      tags,
    },
    inAccount
  );
  new aws.backup.Selection(
    `${name}-backup`,
    {
      name: `${BASE_NAME}-data-${stack}`,
      planId: backupPlan.id,
      iamRoleArn: backupRole.arn,
      resources: [fileSystem.arn],
    },
    inAccount
  );

  // --- TLS, the NLB, and PrivateLink ------------------------------------------

  // Issued in the OpenBao account for the same name, validated through the
  // main account's zone.
  const certificate = new aws.acm.Certificate(
    `${name}-certificate`,
    { domainName: HOSTNAME, validationMethod: 'DNS', tags },
    inAccount
  );
  const validation = certificate.domainValidationOptions[0];
  const validationRecord = new aws.route53.Record(
    `${name}-certificate-validation`,
    {
      zoneId,
      name: validation.resourceRecordName,
      type: validation.resourceRecordType,
      records: [validation.resourceRecordValue],
      ttl: 300,
    }
  );
  const validatedCertificate = new aws.acm.CertificateValidation(
    `${name}-certificate`,
    {
      certificateArn: certificate.arn,
      validationRecordFqdns: [validationRecord.fqdn],
    },
    inAccount
  );

  // Internal, in the vault's VPC; PrivateLink exposes it to the shared VPC.
  // TLS terminates here with the ACM certificate.
  const loadBalancer = new aws.lb.LoadBalancer(
    `${name}-nlb`,
    {
      name: `${BASE_NAME}-${stack}`,
      internal: true,
      loadBalancerType: 'network',
      subnets: network.subnetIds,
      securityGroups: [loadBalancerSecurityGroup.id],
      enforceSecurityGroupInboundRulesOnPrivateLinkTraffic: 'off',
      enableCrossZoneLoadBalancing: true,
      tags,
    },
    inAccount
  );
  const targetGroup = new aws.lb.TargetGroup(
    `${name}-nlb-tg`,
    {
      name: `${BASE_NAME}-${stack}`,
      vpcId: network.vpcId,
      targetType: 'ip',
      protocol: 'TCP',
      port: API_PORT,
      preserveClientIp: 'false',
      // Below the shared 15 s default: the old task drains before the new one
      // starts (stop-then-start), so every second here is outage.
      deregistrationDelay: 5,
      healthCheck: {
        ...DEFAULT_TARGET_GROUP_HEALTH_CHECK,
        protocol: 'HTTP',
        // Uninitialized (the first deploy, before `operator init`) answers 200
        // instead of 501. Sealed (503) stays unhealthy, so ECS replaces it.
        path: '/v1/sys/health?uninitcode=200',
        matcher: '200',
      },
      tags,
    },
    inAccount
  );
  const listener = new aws.lb.Listener(
    `${name}-tls`,
    {
      loadBalancerArn: loadBalancer.arn,
      port: HTTPS_PORT,
      protocol: 'TLS',
      sslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
      certificateArn: validatedCertificate.certificateArn,
      defaultActions: [{ type: 'forward', targetGroupArn: targetGroup.arn }],
      tags,
    },
    inAccount
  );

  // Only the main account may connect, and every connection needs acceptance;
  // the one accepted below is DSS's endpoint in the shared VPC.
  const endpointService = new aws.ec2.VpcEndpointService(
    `${name}-service`,
    {
      acceptanceRequired: true,
      networkLoadBalancerArns: [loadBalancer.arn],
      allowedPrincipals: [
        pulumi.interpolate`arn:aws:iam::${mainAccountId}:root`,
      ],
      tags: { ...tags, Name: `${BASE_NAME}-${stack}` },
    },
    inAccount
  );
  const consumerEndpoint = new aws.ec2.VpcEndpoint(`${name}-consumer`, {
    vpcId: sharedVpcId,
    serviceName: endpointService.serviceName,
    vpcEndpointType: 'Interface',
    privateDnsEnabled: false,
    subnetIds: coparse_api_vpc_filtered_subnets(
      ZONES.map((zone) => zone.mainAccountZone)
    ),
    securityGroupIds: [consumerEndpointSecurityGroup.id],
    tags: { ...tags, Name: `${BASE_NAME}-${stack}` },
  });
  new aws.ec2.VpcEndpointConnectionAccepter(
    `${name}-consumer`,
    {
      vpcEndpointServiceId: endpointService.id,
      vpcEndpointId: consumerEndpoint.id,
    },
    inAccount
  );

  // --- Image and logs -----------------------------------------------------------

  // The same image as the legacy vault, pushed to this account's ECR so the
  // pull stays inside it.
  const image = new EcrImage(
    `${name}-ecr-image`,
    {
      repositoryId: `${name}-ecr-${stack}`,
      repositoryName: `${BASE_NAME}-${stack}`,
      imageId: `${name}-image-${stack}`,
      imagePath: `${__dirname}/image`,
      dockerfile: 'Dockerfile',
      platform: { family: 'linux', architecture: 'amd64' },
      tags,
    },
    { providers: { aws: provider } }
  );

  // One Datadog path: the log group here subscribes to a Logs destination in
  // the main account, which writes into the same shared Firehose. Datadog names
  // a non-Lambda group's service after it: `service:openbao-dev`.
  const logGroup = new aws.cloudwatch.LogGroup(
    `${name}-logs`,
    { name: `${BASE_NAME}-${stack}`, retentionInDays: 30, tags },
    inAccount
  );
  const logDestination = new aws.cloudwatch.LogDestination(
    `${name}-logs-destination`,
    {
      name: `${BASE_NAME}-${stack}`,
      targetArn: DATADOG_KINESIS_FIREHOSE_STREAM_ARN,
      roleArn: CLOUDWATCH_KINESIS_STREAM_ROLE_ARN,
      tags,
    }
  );
  const logDestinationPolicy = new aws.cloudwatch.LogDestinationPolicy(
    `${name}-logs-destination`,
    {
      destinationName: logDestination.name,
      accessPolicy: pulumi.jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: OPENBAO_ACCOUNT_ID },
            Action: 'logs:PutSubscriptionFilter',
            Resource: logDestination.arn,
          },
        ],
      }),
    }
  );
  new aws.cloudwatch.LogSubscriptionFilter(
    `${name}-logs-datadog`,
    {
      name: `${BASE_NAME}-datadog-${stack}`,
      logGroup: logGroup.name,
      destinationArn: logDestination.arn,
      filterPattern: '',
    },
    { ...inAccount, dependsOn: [logDestinationPolicy] }
  );

  // --- Service ------------------------------------------------------------------

  const serverConfig = sealKey.arn.apply((sealKeyArn) =>
    renderServerConfig({ apiAddress: API_ADDRESS, region, sealKeyArn })
  );
  // Its own cluster: nothing else runs beside the vault.
  const cluster = new aws.ecs.Cluster(
    `${name}-cluster`,
    { name: `${BASE_NAME}-${stack}`, tags },
    inAccount
  );
  const service = new awsx.ecs.FargateService(
    name,
    {
      name: `${BASE_NAME}-${stack}`,
      cluster: cluster.arn,
      desiredCount: 1,
      // Raft data must never be open in two tasks: stop the old one first.
      deploymentMinimumHealthyPercent: 0,
      deploymentMaximumPercent: 100,
      continueBeforeSteadyState: DEFAULT_CONTINUE_BEFORE_STEADY_STATE,
      deploymentCircuitBreaker: { enable: true, rollback: true },
      enableExecuteCommand: true,
      networkConfiguration: {
        subnets: network.subnetIds,
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
        family: `${BASE_NAME}-${stack}`,
        // The container logs to the group above; awsx's own would stay empty.
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
        containers: {
          openbao: {
            name: 'openbao',
            image: image.image.imageUri,
            essential: true,
            command: ['server'],
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
              logDriver: 'awslogs',
              options: {
                'awslogs-group': logGroup.name,
                'awslogs-region': region,
                'awslogs-stream-prefix': BASE_NAME,
              },
            },
          },
        },
      },
      tags,
    },
    {
      providers: { aws: provider },
      dependsOn: [
        listener,
        taskIngress,
        ...taskEgress,
        endpointIngress,
        efsIngress,
        ...mountTargets,
        ...network.ready,
      ],
    }
  );

  // --- Alarms -------------------------------------------------------------------

  // CloudWatch alarms notify only topics in their own account. Subscribing this
  // topic to on-call is a follow-up (README "Moving the vault to the OpenBao
  // account").
  const alarmTopic = new aws.sns.Topic(
    `${name}-alarms`,
    { name: `${BASE_NAME}-alarms-${stack}`, tags },
    inAccount
  );
  new EcsDeploymentFailureAlarm(
    `${name}-deployment-failure-alarm`,
    {
      serviceName: `${BASE_NAME}-${stack}`,
      serviceArn: service.service.arn,
      alarmActions: [alarmTopic.arn],
      tags,
    },
    { providers: { aws: provider } }
  );
  new aws.cloudwatch.MetricAlarm(
    `${name}-unhealthy-alarm`,
    {
      name: `${BASE_NAME}-unhealthy-${stack}`,
      namespace: 'AWS/NetworkELB',
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
      alarmActions: [alarmTopic.arn],
      okActions: [alarmTopic.arn],
      tags,
    },
    inAccount
  );

  return {
    accountId: OPENBAO_ACCOUNT_ID,
    clusterName: cluster.name,
    serviceName: service.service.name,
    sealKeyArn: sealKey.arn,
    fileSystemId: fileSystem.id,
    fileSystemArn: fileSystem.arn,
    backupRoleArn: backupRole.arn,
    backupVaultName: backupVault.name,
    /** The operator tunnel's remote host, reached from inside the task. */
    loadBalancerDnsName: loadBalancer.dnsName,
    /** What the follow-up points `openbao-dev.macro-internal.com` at. */
    consumerEndpointDnsName: consumerEndpoint.dnsEntries[0].dnsName,
    consumerEndpointZoneId: consumerEndpoint.dnsEntries[0].hostedZoneId,
  };
}
