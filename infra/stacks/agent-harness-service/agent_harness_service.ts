import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import {
  DATADOG_API_KEY,
  DEFAULT_CONTINUE_BEFORE_STEADY_STATE,
  EcsDeploymentFailureAlarm,
  ServiceTargetGroup,
  datadogAgentContainer,
  fargateLogRouterSidecarContainer,
} from '../../packages/resources';
import { EcrImage } from '../../packages/service';
import {
  CLOUD_TRAIL_SNS_TOPIC_ARN,
  DopplerEcsEnvironment,
  getGatewayAlb,
  getKafkaClusterPolicy,
  getServiceUrl,
  GatewayService,
  ServiceUrl,
  stack,
} from '../../packages/shared';

const gatewayLoadBalancer = getGatewayAlb();

const BASE_NAME = pulumi.getProject();
const REPO_ROOT = '../../..';

type Args = {
  vpc: {
    vpcId: pulumi.Output<string> | string;
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  tags: { [key: string]: string };
  containerEnvVars: { name: string; value: pulumi.Output<string> | string }[];
  platform: { family: string; architecture: 'amd64' | 'arm64' };
  serviceContainerPort: number;
  /** Container port of the sandbox-facing egress proxy listener. */
  egressContainerPort: number;
  healthCheckPath: string;
  ecsClusterArn: pulumi.Output<string> | string;
  cloudStorageClusterName: pulumi.Output<string> | string;
  secretKeyArns: (pulumi.Output<string> | string)[];
  /** SQS queues the service is allowed to send messages to. */
  queueArns: (pulumi.Output<string> | string)[];
  /** S3 buckets the service needs access to. */
  bucketArns: (pulumi.Output<string> | string)[];
};

/**
 * The agent harness service. Replicated in every environment: each replica
 * claims the sessions whose live actors it holds through Postgres ownership,
 * and commands are broadcast through the shared Redis deployment so the
 * responsible replica can execute them. The Kafka consumer group splits
 * partitions across live tasks; ownership plus Redis routing is what makes
 * that split correct.
 *
 */
export class AgentHarnessService extends pulumi.ComponentResource {
  public role: aws.iam.Role;
  public ecr: awsx.ecr.Repository;
  public serviceSg: aws.ec2.SecurityGroup;
  public domain: string;
  public egressDomain: string;
  public targetGroup: aws.lb.TargetGroup;
  public egressTargetGroup: aws.lb.TargetGroup;
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
      egressContainerPort,
      healthCheckPath,
      ecsClusterArn,
      cloudStorageClusterName,
      containerEnvVars,
      secretKeyArns,
      queueArns,
      bucketArns,
    } = args;

    this.domain = getServiceUrl(ServiceUrl.AGENT_HARNESS_SERVICE_URL);
    this.egressDomain = getServiceUrl(ServiceUrl.AGENT_HARNESS_EGRESS_URL);
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

    const serviceSg = this.initializeSecurityGroups({ vpcId: vpc.vpcId });
    this.serviceSg = serviceSg;

    const gatewayTargetGroup = new ServiceTargetGroup(
      `${stack}-${BASE_NAME}`,
      {
        tags: this.tags,
        listenerArn: gatewayLoadBalancer.httpsListenerArn,
        vpcId: vpc.vpcId,
        containerPort: serviceContainerPort,
        service: GatewayService.AGENT_HARNESS_SERVICE,
        healthCheckPath,
        pathPatterns: ['/agent-harness', '/agent-harness/*'],
        serviceSecurityGroupId: serviceSg.id,
        albSecurityGroupId: gatewayLoadBalancer.albSecurityGroupId,
      },
      { parent: this }
    );

    this.targetGroup = gatewayTargetGroup.target_group;

    // Forward the egress prefix unchanged to its own listener. Session-token
    // Authorization headers are handled by the egress router as before.
    // Use a new target group: AWS cannot attach one to two ALBs during cutover.
    // Keep the name (including the helper's -tg suffix) below 32 characters.
    const egress = new ServiceTargetGroup(
      `ah-egress-gateway-${stack}`,
      {
        listenerArn: gatewayLoadBalancer.httpsListenerArn,
        vpcId: vpc.vpcId,
        containerPort: egressContainerPort,
        healthCheckPath,
        pathPatterns: ['/agent-harness-egress', '/agent-harness-egress/*'],
        service: GatewayService.AGENT_HARNESS_EGRESS,
        serviceSecurityGroupId: serviceSg.id,
        albSecurityGroupId: gatewayLoadBalancer.albSecurityGroupId,
        tags,
      },
      { parent: this }
    );
    this.egressTargetGroup = egress.target_group;

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
        deploymentMinimumHealthyPercent: 100,
        deploymentMaximumPercent: 200,
        // Every environment runs two, so dev stays prod-shaped: forwarding is
        // dead code at one task (management() can only answer Ours or
        // Unmanaged), and a path only dev never exercises is one whose
        // regressions surface in prod.
        desiredCount: 2,
        // ALB checks /health every 10s and fails the target after two
        // misses (~20s). HTTP does not listen until after DB, AWS config,
        // and JWT secrets, so a 0s grace period trips the circuit breaker
        // before the replacement binds. Ignore those checks until then.
        healthCheckGracePeriodSeconds: 120,
        // Both listeners use the shared gateway, with separate target groups
        // for the control API and sandbox egress proxy.
        loadBalancers: [
          {
            targetGroupArn: gatewayTargetGroup.target_group.arn,
            containerName: 'service',
            containerPort: serviceContainerPort,
          },
          {
            targetGroupArn: this.egressTargetGroup.arn,
            containerName: 'service',
            containerPort: egressContainerPort,
          },
        ],
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
                  targetGroup: this.targetGroup,
                },
                {
                  appProtocol: 'http',
                  name: `${BASE_NAME}-egress-tcp-${stack}`,
                  hostPort: egressContainerPort,
                  containerPort: egressContainerPort,
                  targetGroup: this.egressTargetGroup,
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
        // ECS refuses a service whose target group is not yet associated
        // with a load balancer; it is the listener rule that creates that
        // association.
        dependsOn: [gatewayTargetGroup.listener_rule, egress.listener_rule],
      }
    );

    this.setupServiceAlarms();
  }

  private initializeSecurityGroups({
    vpcId,
  }: {
    vpcId: pulumi.Output<string> | string;
  }) {
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

    return serviceSg;
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
