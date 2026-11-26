import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import {
  DATADOG_API_KEY,
  DEFAULT_CONTINUE_BEFORE_STEADY_STATE,
  EcsDeploymentFailureAlarm,
  withTelemetry,
} from '../../packages/resources';
import { EcrImage } from '../../packages/service';
import {
  CLOUD_TRAIL_SNS_TOPIC_ARN,
  DopplerEcsEnvironment,
  RDS_PORT,
  stack,
} from '../../packages/shared';

const BASE_NAME = pulumi.getProject();
const REPO_ROOT = '../../..';

const CREDENTIAL_KMS_ACTIONS = ['kms:Encrypt', 'kms:Decrypt'];
// Matches the purpose in crates/imap_engine/src/outbound/crypto.rs. The key
// refuses any call that does not carry it, so this key cannot be used as a
// general-purpose encryption oracle even by its own role.
const CREDENTIAL_KMS_PURPOSE = 'imap-credentials-v1';

// Drain in-flight operations and release fenced account leases on SIGTERM.
const STOP_TIMEOUT_SECONDS = 120;

type ImapServiceArgs = {
  vpc: {
    vpcId: pulumi.Input<string>;
    privateSubnetIds: pulumi.Input<string[]>;
  };
  ecsClusterArn: pulumi.Input<string>;
  ecsClusterName: pulumi.Input<string>;
  kmsDeletionWindowInDays: number;
  tags: { [key: string]: string };
};

/**
 * Internal IMAP/SMTP engine. Email service discovers it through private DNS;
 * authenticated operations never pass through the public gateway.
 */
export class ImapService extends pulumi.ComponentResource {
  readonly role: aws.iam.Role;
  readonly serviceSg: aws.ec2.SecurityGroup;
  readonly service: awsx.ecs.FargateService;
  readonly kmsKeyArn: pulumi.Output<string>;
  readonly kmsKeyAlias: pulumi.Output<string>;
  readonly logGroupName: pulumi.Output<string>;

  constructor(
    name: string,
    args: ImapServiceArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:ImapService', name, {}, opts);
    const { tags } = args;
    const child = { parent: this };

    this.role = new aws.iam.Role(
      `${BASE_NAME}-role`,
      {
        name: `${BASE_NAME}-role-${stack}`,
        assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
          Service: 'ecs-tasks.amazonaws.com',
        }),
        tags,
      },
      child
    );

    // A key of its own: the Cursor, Codex, and Microsoft keys protect other
    // secrets with other readers. Only this task role may encrypt or decrypt
    // saved mailbox credentials; DSS gets nothing.
    const accountRootArn = pulumi.interpolate`arn:aws:iam::${aws.getCallerIdentityOutput().accountId}:root`;
    const kmsKey = new aws.kms.Key(
      `${BASE_NAME}-credential-key`,
      {
        description: `IMAP/SMTP mailbox data keys for ${stack}`,
        deletionWindowInDays: args.kmsDeletionWindowInDays,
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
            {
              sid: 'AllowImapServiceCredentialEncryption',
              effect: 'Allow',
              principals: [{ type: 'AWS', identifiers: [this.role.arn] }],
              actions: CREDENTIAL_KMS_ACTIONS,
              resources: ['*'],
              conditions: [
                {
                  test: 'StringEquals',
                  variable: 'kms:EncryptionContext:purpose',
                  values: [CREDENTIAL_KMS_PURPOSE],
                },
              ],
            },
          ],
        }).json,
        tags,
      },
      { parent: this, protect: stack === 'prod' }
    );
    const kmsAlias = new aws.kms.Alias(
      `${BASE_NAME}-credential-key-alias`,
      {
        name: `alias/${BASE_NAME}-${stack}`,
        targetKeyId: kmsKey.keyId,
      },
      child
    );
    new aws.iam.RolePolicy(
      `${BASE_NAME}-credential-kms-policy`,
      {
        role: this.role.id,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: CREDENTIAL_KMS_ACTIONS,
              Resource: kmsKey.arn,
              Effect: 'Allow',
              Condition: {
                StringEquals: {
                  'kms:EncryptionContext:purpose': CREDENTIAL_KMS_PURPOSE,
                },
              },
            },
          ],
        },
      },
      child
    );
    this.kmsKeyArn = kmsKey.arn;
    this.kmsKeyAlias = kmsAlias.name;

    this.serviceSg = new aws.ec2.SecurityGroup(
      `${BASE_NAME}-sg-${stack}`,
      {
        name: `${BASE_NAME}-sg-${stack}`,
        vpcId: args.vpc.vpcId,
        description:
          'Internal authenticated IMAP engine and restricted mail egress',
        tags,
      },
      child
    );
    // Discovery, AWS APIs and telemetry use HTTPS. Protocol egress is separate.
    const httpsEgress = new aws.vpc.SecurityGroupEgressRule(
      `${BASE_NAME}-https-out`,
      {
        securityGroupId: this.serviceSg.id,
        description: 'HTTPS to mail, AWS APIs, and Datadog',
        cidrIpv4: '0.0.0.0/0',
        ipProtocol: 'tcp',
        fromPort: 443,
        toPort: 443,
        tags,
      },
      child
    );
    // MacroDB (direct instance endpoint and RDS Proxy) lives in this VPC.
    const vpcCidr = aws.ec2.getVpcOutput({ id: args.vpc.vpcId }).cidrBlock;
    const apiIngress = new aws.vpc.SecurityGroupIngressRule(
      `${BASE_NAME}-api-in`,
      {
        securityGroupId: this.serviceSg.id,
        description:
          'Internal API; every account request requires service authentication',
        cidrIpv4: vpcCidr,
        ipProtocol: 'tcp',
        fromPort: 8080,
        toPort: 8080,
        tags,
      },
      child
    );
    const mailEgress = [143, 993, 465, 587].map(
      (port) =>
        new aws.vpc.SecurityGroupEgressRule(
          `${BASE_NAME}-mail-${port}-out`,
          {
            securityGroupId: this.serviceSg.id,
            description:
              'Mail protocols; engine validates and pins public destinations',
            cidrIpv4: '0.0.0.0/0',
            ipProtocol: 'tcp',
            fromPort: port,
            toPort: port,
            tags,
          },
          child
        )
    );
    const postgresEgress = new aws.vpc.SecurityGroupEgressRule(
      `${BASE_NAME}-postgres-out`,
      {
        securityGroupId: this.serviceSg.id,
        description: 'Postgres to MacroDB',
        cidrIpv4: vpcCidr,
        ipProtocol: 'tcp',
        fromPort: RDS_PORT,
        toPort: RDS_PORT,
        tags,
      },
      child
    );

    // The FireLens router's own diagnostics; application logs ship to Datadog.
    const logGroup = new aws.cloudwatch.LogGroup(
      `${BASE_NAME}-log-group`,
      {
        name: `/ecs/${BASE_NAME}-${stack}`,
        retentionInDays: 30,
        tags,
      },
      child
    );
    this.logGroupName = logGroup.name;

    const image = new EcrImage(
      `${BASE_NAME}-ecr-image-${stack}`,
      {
        repositoryId: `${BASE_NAME}-ecr-${stack}`,
        repositoryName: `${BASE_NAME}-${stack}`,
        imageId: `${BASE_NAME}-image-${stack}`,
        imagePath: REPO_ROOT,
        dockerfile: 'docker/Dockerfile',
        platform: { family: 'linux', architecture: 'amd64' },
        buildArgs: { SERVICE_NAME: 'imap_service' },
        tags,
      },
      child
    );

    const dopplerEcsEnvironment = new DopplerEcsEnvironment(
      BASE_NAME,
      { tags },
      child
    );

    const namespace = new aws.servicediscovery.PrivateDnsNamespace(
      `${BASE_NAME}-private-dns`,
      { name: `imap-${stack}.macro.internal`, vpc: args.vpc.vpcId, tags },
      child
    );
    const discovery = new aws.servicediscovery.Service(
      `${BASE_NAME}-discovery`,
      {
        name: 'engine',
        dnsConfig: {
          namespaceId: namespace.id,
          routingPolicy: 'MULTIVALUE',
          dnsRecords: [{ type: 'A', ttl: 10 }],
        },
        healthCheckCustomConfig: { failureThreshold: 1 },
        tags,
      },
      child
    );
    this.service = new awsx.ecs.FargateService(
      BASE_NAME,
      {
        cluster: args.ecsClusterArn,
        desiredCount: 1,
        serviceRegistries: { registryArn: discovery.arn },
        // Leases fence replacement tasks during a rolling deployment.
        deploymentMinimumHealthyPercent: 100,
        deploymentMaximumPercent: 200,
        continueBeforeSteadyState: DEFAULT_CONTINUE_BEFORE_STEADY_STATE,
        deploymentCircuitBreaker: { enable: true, rollback: true },
        networkConfiguration: {
          subnets: args.vpc.privateSubnetIds,
          securityGroups: [this.serviceSg.id],
          assignPublicIp: false,
        },
        taskDefinitionArgs: {
          cpu: stack === 'prod' ? '1024' : '512',
          memory: stack === 'prod' ? '4096' : '2048',
          taskRole: { roleArn: this.role.arn },
          executionRole: { roleArn: dopplerEcsEnvironment.executionRole.arn },
          runtimePlatform: {
            operatingSystemFamily: 'LINUX',
            cpuArchitecture: 'X86_64',
          },
          containers: withTelemetry(
            BASE_NAME,
            {
              service: {
                name: 'service',
                image: image.image.imageUri,
                essential: true,
                stopTimeout: STOP_TIMEOUT_SECONDS,
                // Stopping runs in reverse dependency order, so the sidecars
                // outlive the drain and its logs and spans still ship.
                dependsOn: [
                  { containerName: 'log_router', condition: 'START' },
                  { containerName: 'datadog_agent', condition: 'START' },
                ],
                secrets: [...dopplerEcsEnvironment.containerSecrets],
                environment: [
                  { name: 'ENVIRONMENT', value: stack },
                  { name: 'DD_SERVICE', value: BASE_NAME },
                  { name: 'DD_ENV', value: stack },
                  { name: 'RUST_BACKTRACE', value: '1' },
                ],
                // `GET /health` on 8080 is for local compose; the image has
                // no HTTP client for an ECS container health check.
                portMappings: [{ containerPort: 8080, hostPort: 8080 }],
                logConfiguration: {
                  logDriver: 'awsfirelens',
                  options: {
                    Name: 'datadog',
                    Host: 'http-intake.logs.us5.datadoghq.com',
                    // Egress allows only 443; Fluent Bit defaults to plain 80.
                    TLS: 'on',
                    Port: '443',
                    apikey: DATADOG_API_KEY,
                    dd_service: BASE_NAME,
                    dd_source: 'fargate',
                    dd_tags: `env:${stack}`,
                    provider: 'ecs',
                  },
                },
              },
            },
            {
              logRouter: {
                stopTimeout: STOP_TIMEOUT_SECONDS,
                logConfiguration: {
                  logDriver: 'awslogs',
                  options: {
                    'awslogs-group': logGroup.name,
                    'awslogs-region': 'us-east-1',
                    'awslogs-stream-prefix': 'log_router',
                  },
                },
              },
              datadogAgent: { stopTimeout: STOP_TIMEOUT_SECONDS },
            }
          ),
        },
        tags,
      },
      {
        parent: this,
        dependsOn: [httpsEgress, postgresEgress, apiIngress, ...mailEgress],
      }
    );

    new EcsDeploymentFailureAlarm(
      `${BASE_NAME}-deployment-failure-alarm`,
      {
        serviceName: BASE_NAME,
        serviceArn: this.service.service.arn,
        tags,
      },
      child
    );

    for (const [metricName, label] of [
      ['CPUUtilization', 'CPU'],
      ['MemoryUtilization', 'Memory'],
    ]) {
      new aws.cloudwatch.MetricAlarm(
        `${BASE_NAME}-high-${label.toLowerCase()}-alarm`,
        {
          name: `${BASE_NAME}-high-${label.toLowerCase()}-alarm-${stack}`,
          metricName,
          namespace: 'AWS/ECS',
          statistic: 'Average',
          period: 180,
          evaluationPeriods: 2,
          threshold: 80,
          comparisonOperator: 'GreaterThanThreshold',
          dimensions: {
            ClusterName: args.ecsClusterName,
            ServiceName: this.service.service.name,
          },
          alarmDescription: `High ${label} usage alarm for ${BASE_NAME}.`,
          actionsEnabled: true,
          alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
          tags,
        },
        child
      );
    }
  }
}
