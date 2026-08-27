import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import {
  DATADOG_API_KEY,
  DEFAULT_CONTINUE_BEFORE_STEADY_STATE,
  EcsDeploymentFailureAlarm,
  datadogAgentContainer,
  fargateLogRouterSidecarContainer,
  serviceLoadBalancer,
} from '../../packages/resources';
import { EcrImage } from '../../packages/service';
import {
  BASE_DOMAIN,
  CLOUD_TRAIL_SNS_TOPIC_ARN,
  DopplerEcsEnvironment,
  getKafkaClusterPolicy,
  stack,
} from '../../packages/shared';

const BASE_NAME = pulumi.getProject();
const REPO_ROOT = '../../..';

export const SERVICE_DOMAIN_NAME = `agent-harness${
  stack === 'prod' ? '' : `-${stack}`
}.${BASE_DOMAIN}`;

type Args = {
  vpc: {
    vpcId: pulumi.Output<string> | string;
    publicSubnetIds: pulumi.Output<string[]> | string[];
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  tags: { [key: string]: string };
  containerEnvVars: { name: string; value: pulumi.Output<string> | string }[];
  platform: { family: string; architecture: 'amd64' | 'arm64' };
  serviceContainerPort: number;
  healthCheckPath: string;
  isPrivate?: boolean;
  ecsClusterArn: pulumi.Output<string> | string;
  cloudStorageClusterName: pulumi.Output<string> | string;
  secretKeyArns: (pulumi.Output<string> | string)[];
  /** SQS queues the service is allowed to send messages to. */
  queueArns: (pulumi.Output<string> | string)[];
  /** S3 buckets the service needs access to. */
  bucketArns: (pulumi.Output<string> | string)[];
};

/**
 * The agent harness service. Like agent-proxy before it, this component pins
 * `desiredCount` to 1 and forces a stop-then-start deployment (min healthy
 * 0%, max 100%) with no autoscaling: the harness owns the live agent-session
 * actors in process memory with no cross-instance sync, and its Kafka consumer
 * groups must not split partitions across two momentarily-coexisting tasks
 * (see the consumer groups in `services/agent_harness_service`).
 */
export class AgentHarnessService extends pulumi.ComponentResource {
  public role: aws.iam.Role;
  public ecr: awsx.ecr.Repository;
  public serviceAlbSg: aws.ec2.SecurityGroup;
  public serviceSg: aws.ec2.SecurityGroup;
  public domain: string;
  public targetGroup: aws.lb.TargetGroup;
  public lb: aws.lb.LoadBalancer;
  public listener: aws.lb.Listener;
  public service: awsx.ecs.FargateService;
  public cloudStorageClusterName: pulumi.Output<string> | string;
  public tags: { [key: string]: string };

  constructor(
    name: string,
    args: Args,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:AgentHarnessService', name, {}, opts);
    const {
      vpc,
      tags,
      platform,
      serviceContainerPort,
      healthCheckPath,
      isPrivate,
      ecsClusterArn,
      cloudStorageClusterName,
      containerEnvVars,
      secretKeyArns,
      queueArns,
      bucketArns,
    } = args;

    this.domain = `https://${SERVICE_DOMAIN_NAME}`;
    this.cloudStorageClusterName = cloudStorageClusterName;
    this.tags = tags;

    const secretsManagerPolicy = new aws.iam.Policy(
      `${BASE_NAME}-secrets-manager-policy`,
      {
        name: `${BASE_NAME}-secrets-manager-policy-${stack}`,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: [
                'secretsmanager:GetSecretValue',
                'secretsmanager:DescribeSecret',
              ],
              Resource: secretKeyArns,
              Effect: 'Allow',
            },
          ],
        },
        tags,
      },
      { parent: this }
    );

    // The harness fans channel side effects and in-memory AI tool work out
    // over the same queues as the other AI tool hosts.
    const queuePolicy = new aws.iam.Policy(
      `${BASE_NAME}-queue-policy`,
      {
        name: `${BASE_NAME}-queue-policy-${stack}`,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: [
                'sqs:SendMessage',
                'sqs:GetQueueUrl',
                'sqs:GetQueueAttributes',
              ],
              Resource: queueArns,
              Effect: 'Allow',
            },
          ],
        },
        tags,
      },
      { parent: this }
    );

    const s3Policy =
      bucketArns.length > 0
        ? new aws.iam.Policy(
            `${BASE_NAME}-s3-policy`,
            {
              name: `${BASE_NAME}-s3-policy-${stack}`,
              policy: pulumi.output({
                Version: '2012-10-17',
                Statement: [
                  {
                    Effect: 'Allow',
                    Action: [
                      's3:ListBucket',
                      's3:GetObject',
                      's3:PutObject',
                      's3:DeleteObject',
                    ],
                    Resource: bucketArns.flatMap((arn) => [
                      arn,
                      pulumi.interpolate`${arn}/*`,
                    ]),
                  },
                ],
              }),
              tags,
            },
            { parent: this }
          )
        : undefined;

    this.role = new aws.iam.Role(
      `${BASE_NAME}-role`,
      {
        name: `${BASE_NAME}-role-${stack}`,
        assumeRolePolicy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: 'sts:AssumeRole',
              Principal: {
                Service: 'ecs-tasks.amazonaws.com',
              },
              Effect: 'Allow',
            },
          ],
        },
        managedPolicyArns: [
          secretsManagerPolicy.arn,
          queuePolicy.arn,
          ...(s3Policy ? [s3Policy.arn] : []),
        ],
        tags,
      },
      { parent: this }
    );

    // Producer/consumer access to the macro event Kafka cluster: the harness
    // consumes `macro.channels` and `macro.agent_sessions`, publishes agent
    // triggers, and publishes channel side effects.
    new aws.iam.RolePolicyAttachment(
      `${BASE_NAME}-role-kafka-client-att-${stack}`,
      {
        role: this.role,
        policyArn: getKafkaClusterPolicy(),
      },
      { parent: this, dependsOn: [this.role] }
    );

    const image = new EcrImage(
      `${BASE_NAME}-ecr-image-${stack}`,
      {
        repositoryId: `${BASE_NAME}-ecr-${stack}`,
        repositoryName: `${BASE_NAME}-${stack}`,
        imageId: `${BASE_NAME}-image-${stack}`,
        imagePath: REPO_ROOT,
        dockerfile: 'docker/Dockerfile',
        platform,
        buildArgs: {
          SERVICE_NAME: 'agent_harness_service',
        },
        tags,
      },
      { parent: this }
    );
    this.ecr = image.ecr;

    const { serviceAlbSg, serviceSg } = this.initializeSecurityGroups({
      vpcId: vpc.vpcId,
      serviceContainerPort,
    });
    this.serviceAlbSg = serviceAlbSg;
    this.serviceSg = serviceSg;

    const { targetGroup, lb, listener } = serviceLoadBalancer(this, {
      serviceName: BASE_NAME,
      serviceContainerPort,
      healthCheckPath,
      vpc,
      albSecurityGroupId: serviceAlbSg.id,
      isPrivate,
      tags,
    });
    this.targetGroup = targetGroup;
    this.lb = lb;
    this.listener = listener;

    const dopplerEcsEnvironment = new DopplerEcsEnvironment(
      BASE_NAME,
      { tags: this.tags },
      { parent: this }
    );

    this.service = new awsx.ecs.FargateService(
      `${BASE_NAME}`,
      {
        tags,
        cluster: ecsClusterArn,
        networkConfiguration: {
          subnets: vpc.privateSubnetIds,
          securityGroups: [serviceSg.id],
        },
        continueBeforeSteadyState: DEFAULT_CONTINUE_BEFORE_STEADY_STATE,
        deploymentCircuitBreaker: {
          enable: true,
          rollback: true,
        },
        // Never run 2 tasks at once, even transiently during a deploy: stop
        // the old one before the new one starts (see the class doc comment).
        deploymentMinimumHealthyPercent: 0,
        deploymentMaximumPercent: 100,
        desiredCount: 1,
        // ALB checks /health every 10s and fails the target after two
        // misses (~20s). HTTP does not listen until after DB, AWS config,
        // and JWT secrets, so a 0s grace period trips the circuit breaker
        // on this stop-then-start replace. Ignore those checks until bind.
        healthCheckGracePeriodSeconds: 120,
        taskDefinitionArgs: {
          taskRole: {
            roleArn: this.role.arn,
          },
          executionRole: {
            roleArn: dopplerEcsEnvironment.executionRole.arn,
          },
          containers: {
            log_router: fargateLogRouterSidecarContainer,
            datadog_agent: datadogAgentContainer,
            service: {
              name: BASE_NAME,
              image: image.image.imageUri,
              // Daytona cleanup can make two 30-second stop attempts. Give the
              // singleton time to release sandbox capacity before ECS kills it.
              stopTimeout: 120,
              cpu: 1024,
              memory: 2048,
              environment: [
                ...containerEnvVars,
                {
                  name: 'BASE_URL',
                  value: this.domain,
                },
              ],
              secrets: [...dopplerEcsEnvironment.containerSecrets],
              logConfiguration: {
                logDriver: 'awsfirelens',
                options: {
                  Name: 'datadog',
                  Host: 'http-intake.logs.us5.datadoghq.com',
                  apikey: DATADOG_API_KEY,
                  dd_service: 'agent-harness-service',
                  dd_source: 'fargate',
                  dd_tags: `project:agent-harness-service, env:${stack}`,
                  provider: 'ecs',
                },
              },
              portMappings: [
                {
                  appProtocol: 'http',
                  name: `${BASE_NAME}-tcp-${stack}`,
                  hostPort: serviceContainerPort,
                  containerPort: serviceContainerPort,
                  targetGroup,
                },
              ],
            },
          },
          runtimePlatform: {
            operatingSystemFamily: platform.family.toUpperCase(),
            cpuArchitecture:
              platform.architecture === 'amd64'
                ? 'X86_64'
                : platform.architecture.toUpperCase(),
          },
        },
      },
      {
        parent: this,
      }
    );

    this.setupServiceAlarms();

    const zone = aws.route53.getZoneOutput({ name: BASE_DOMAIN });
    new aws.route53.Record(
      `${BASE_NAME}-domain-record`,
      {
        name: SERVICE_DOMAIN_NAME,
        type: 'A',
        zoneId: zone.zoneId,
        aliases: [
          {
            evaluateTargetHealth: false,
            name: this.lb.dnsName,
            zoneId: this.lb.zoneId,
          },
        ],
      },
      { parent: this }
    );
  }

  private initializeSecurityGroups({
    vpcId,
    serviceContainerPort,
  }: {
    vpcId: pulumi.Output<string> | string;
    serviceContainerPort: number;
  }) {
    const serviceAlbSg = new aws.ec2.SecurityGroup(
      `${BASE_NAME}-alb-sg-${stack}`,
      {
        name: `${BASE_NAME}-alb-sg-${stack}`,
        description: `${BASE_NAME} application load balancer security group`,
        vpcId,
        tags: this.tags,
      },
      { parent: this }
    );

    const serviceSg = new aws.ec2.SecurityGroup(
      `${BASE_NAME}-sg-${stack}`,
      {
        name: `${BASE_NAME}-sg-${stack}`,
        vpcId,
        description: `${BASE_NAME} service security group`,
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupIngressRule(
      `${BASE_NAME}-alb-in`,
      {
        securityGroupId: serviceSg.id,
        description: 'Allow inbound traffic from the service ALB',
        referencedSecurityGroupId: serviceAlbSg.id,
        fromPort: serviceContainerPort,
        toPort: serviceContainerPort,
        ipProtocol: 'tcp',
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupEgressRule(
      `${BASE_NAME}-service-out`,
      {
        securityGroupId: serviceSg.id,
        description: 'Allow all outbound traffic',
        cidrIpv4: '0.0.0.0/0',
        ipProtocol: '-1',
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupIngressRule(
      `${BASE_NAME}-http`,
      {
        securityGroupId: serviceAlbSg.id,
        description: 'Allow inbound HTTP traffic',
        cidrIpv4: '0.0.0.0/0',
        fromPort: 80,
        toPort: 80,
        ipProtocol: 'tcp',
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupIngressRule(
      `${BASE_NAME}-https`,
      {
        securityGroupId: serviceAlbSg.id,
        description: 'Allow inbound HTTPS traffic',
        cidrIpv4: '0.0.0.0/0',
        fromPort: 443,
        toPort: 443,
        ipProtocol: 'tcp',
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupEgressRule(
      `${BASE_NAME}-alb-out`,
      {
        securityGroupId: serviceAlbSg.id,
        description: 'Allow traffic to the service security group',
        referencedSecurityGroupId: serviceSg.id,
        fromPort: serviceContainerPort,
        toPort: serviceContainerPort,
        ipProtocol: 'tcp',
        tags: this.tags,
      },
      { parent: this }
    );

    return { serviceAlbSg, serviceSg };
  }

  private setupServiceAlarms() {
    new EcsDeploymentFailureAlarm(
      `${BASE_NAME}-deployment-failure-alarm`,
      {
        serviceName: BASE_NAME,
        serviceArn: this.service.service.arn,
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.cloudwatch.MetricAlarm(
      `${BASE_NAME}-service-cpu-alarm`,
      {
        name: `${BASE_NAME}-service-cpu-${stack}`,
        alarmDescription: `Alarm when ${BASE_NAME} CPU stays elevated (no autoscaling on this service - single replica only)`,
        namespace: 'AWS/ECS',
        metricName: 'CPUUtilization',
        statistic: 'Average',
        period: 300,
        evaluationPeriods: 2,
        threshold: 90,
        comparisonOperator: 'GreaterThanOrEqualToThreshold',
        dimensions: {
          ClusterName: pulumi.interpolate`${this.cloudStorageClusterName}`,
          ServiceName: this.service.service.name,
        },
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this }
    );
  }
}
