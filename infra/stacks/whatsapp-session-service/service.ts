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

const SESSION_KMS_ACTIONS = ['kms:GenerateDataKey', 'kms:Decrypt'];
// Matches `ENCRYPTION_PURPOSE` in crates/whatsapp_store_pg/src/kms.rs. The key
// refuses any call that does not carry it, so this key cannot be used as a
// general-purpose encryption oracle even by its own role.
const SESSION_KMS_PURPOSE = 'whatsapp-session';

// Fargate's ceiling. Drain on SIGTERM releases accounts in batches and waits
// for in-flight sends' server acks before closing each socket.
const STOP_TIMEOUT_SECONDS = 120;

type WhatsappSessionServiceArgs = {
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
 * Holds personal WhatsApp linked-device sessions: one outbound websocket per
 * account, leased through Postgres advisory locks. Nothing calls it, so it has
 * no load balancer, target group, or inbound rule.
 */
export class WhatsappSessionService extends pulumi.ComponentResource {
  readonly role: aws.iam.Role;
  readonly serviceSg: aws.ec2.SecurityGroup;
  readonly service: awsx.ecs.FargateService;
  readonly kmsKeyArn: pulumi.Output<string>;
  readonly kmsKeyAlias: pulumi.Output<string>;
  readonly logGroupName: pulumi.Output<string>;

  constructor(
    name: string,
    args: WhatsappSessionServiceArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:WhatsappSessionService', name, {}, opts);
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
    // secrets with other readers. Only this task role may generate or unwrap
    // account data keys; DSS gets nothing.
    const accountRootArn = pulumi.interpolate`arn:aws:iam::${aws.getCallerIdentityOutput().accountId}:root`;
    const kmsKey = new aws.kms.Key(
      `${BASE_NAME}-session-key`,
      {
        description: `WhatsApp linked-device session data keys for ${stack}`,
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
              sid: 'AllowSessionServiceEnvelopeEncryption',
              effect: 'Allow',
              principals: [{ type: 'AWS', identifiers: [this.role.arn] }],
              actions: SESSION_KMS_ACTIONS,
              resources: ['*'],
              conditions: [
                {
                  test: 'StringEquals',
                  variable: 'kms:EncryptionContext:macro:purpose',
                  values: [SESSION_KMS_PURPOSE],
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
      `${BASE_NAME}-session-key-alias`,
      {
        name: `alias/${BASE_NAME}-${stack}`,
        targetKeyId: kmsKey.keyId,
      },
      child
    );
    new aws.iam.RolePolicy(
      `${BASE_NAME}-session-kms-policy`,
      {
        role: this.role.id,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: SESSION_KMS_ACTIONS,
              Resource: kmsKey.arn,
              Effect: 'Allow',
              Condition: {
                StringEquals: {
                  'kms:EncryptionContext:macro:purpose': SESSION_KMS_PURPOSE,
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
        description: 'WhatsApp session service: egress only',
        tags,
      },
      child
    );
    // WhatsApp's websocket and media hosts, KMS, Secrets Manager, ECR, and the
    // Datadog intake are all HTTPS. DNS and the Fargate metadata endpoints are
    // not filtered by security groups.
    const httpsEgress = new aws.vpc.SecurityGroupEgressRule(
      `${BASE_NAME}-https-out`,
      {
        securityGroupId: this.serviceSg.id,
        description: 'HTTPS to WhatsApp, AWS APIs, and Datadog',
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
        buildArgs: { SERVICE_NAME: 'whatsapp_session_service' },
        tags,
      },
      child
    );

    const dopplerEcsEnvironment = new DopplerEcsEnvironment(
      BASE_NAME,
      { tags },
      child
    );

    this.service = new awsx.ecs.FargateService(
      BASE_NAME,
      {
        cluster: args.ecsClusterArn,
        desiredCount: stack === 'prod' ? 2 : 1,
        // Start the replacement before stopping the old task: the old task
        // drains and NOTIFYs `whatsapp_account_released` so a running replica
        // takes each account over at once.
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
      { parent: this, dependsOn: [httpsEgress, postgresEgress] }
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
