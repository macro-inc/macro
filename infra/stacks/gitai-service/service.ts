import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import {
  DATADOG_API_KEY,
  DEFAULT_CONTINUE_BEFORE_STEADY_STATE,
  EcsDeploymentFailureAlarm,
  ServiceTargetGroup,
  versionEnvironment,
  withTelemetry,
} from '../../packages/resources';
import { EcrImage } from '../../packages/service';
import {
  CLOUD_TRAIL_SNS_TOPIC_ARN,
  DopplerEcsEnvironment,
  GatewayService,
  getGatewayAlb,
  stack,
} from '../../packages/shared';

const gatewayLoadBalancer = getGatewayAlb();

const BASE_NAME = pulumi.getProject();
const REPO_ROOT = '../../..';
const CONTAINER_PORT = 8080;

type GitaiServiceArgs = {
  /** Task role; the storage component grants it its bucket and table access. */
  role: aws.iam.Role;
  vpc: {
    vpcId: pulumi.Output<string> | string;
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  tags: { [key: string]: string };
  ecsClusterArn: pulumi.Output<string> | string;
  ecsClusterName: pulumi.Output<string> | string;
  /** Doppler values the service reads at startup; tasks wait for them. */
  configurationSecrets: pulumi.Resource[];
};

/** The service's task role, assumable by ECS tasks only. */
export function createTaskRole(tags: { [key: string]: string }) {
  return new aws.iam.Role(`${BASE_NAME}-role`, {
    name: `${BASE_NAME}-role-${stack}`,
    assumeRolePolicy: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Principal: { Service: 'ecs-tasks.amazonaws.com' },
          Effect: 'Allow',
        },
      ],
    },
    tags,
  });
}

/**
 * gitai-service on Fargate behind the shared gateway at `/gitai`: one
 * 0.25 vCPU / 512 MB task, scaling to two.
 */
export class GitaiService extends pulumi.ComponentResource {
  public readonly service: awsx.ecs.FargateService;

  constructor(
    name: string,
    {
      role,
      vpc,
      tags,
      ecsClusterArn,
      ecsClusterName,
      configurationSecrets,
    }: GitaiServiceArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:GitaiService', name, {}, opts);

    const image = new EcrImage(
      `${BASE_NAME}-ecr-image-${stack}`,
      {
        repositoryId: `${BASE_NAME}-ecr-${stack}`,
        repositoryName: `${BASE_NAME}-${stack}`,
        imageId: `${BASE_NAME}-image-${stack}`,
        imagePath: REPO_ROOT,
        dockerfile: 'docker/Dockerfile',
        platform: { family: 'linux', architecture: 'amd64' },
        buildArgs: { SERVICE_NAME: 'gitai_service' },
        tags,
      },
      { parent: this }
    );

    const serviceSg = new aws.ec2.SecurityGroup(
      `${BASE_NAME}-sg-${stack}`,
      {
        name: `${BASE_NAME}-sg-${stack}`,
        vpcId: vpc.vpcId,
        description: `${BASE_NAME} security group that is attached directly to the service`,
        tags,
      },
      { parent: this }
    );
    new aws.vpc.SecurityGroupEgressRule(
      `${BASE_NAME}-all-out`,
      {
        securityGroupId: serviceSg.id,
        description: 'Allow all outbound',
        cidrIpv4: '0.0.0.0/0',
        ipProtocol: '-1',
        tags,
      },
      { parent: this }
    );

    const gatewayTargetGroup = new ServiceTargetGroup(
      `${stack}-${BASE_NAME}`,
      {
        tags,
        listenerArn: gatewayLoadBalancer.httpsListenerArn,
        vpcId: vpc.vpcId,
        containerPort: CONTAINER_PORT,
        service: GatewayService.GITAI_SERVICE,
        healthCheckPath: '/health',
        pathPatterns: ['/gitai', '/gitai/*'],
        serviceSecurityGroupId: serviceSg.id,
        albSecurityGroupId: gatewayLoadBalancer.albSecurityGroupId,
      },
      { parent: this }
    );
    const targetGroup = gatewayTargetGroup.target_group;

    const dopplerEcsEnvironment = new DopplerEcsEnvironment(
      BASE_NAME,
      { tags },
      { parent: this }
    );

    this.service = new awsx.ecs.FargateService(
      BASE_NAME,
      {
        tags,
        cluster: ecsClusterArn,
        networkConfiguration: {
          subnets: vpc.privateSubnetIds,
          securityGroups: [serviceSg.id],
        },
        continueBeforeSteadyState: DEFAULT_CONTINUE_BEFORE_STEADY_STATE,
        deploymentCircuitBreaker: { enable: true, rollback: true },
        loadBalancers: [
          {
            targetGroupArn: targetGroup.arn,
            containerName: 'service',
            containerPort: CONTAINER_PORT,
          },
        ],
        taskDefinitionArgs: {
          taskRole: { roleArn: role.arn },
          executionRole: { roleArn: dopplerEcsEnvironment.executionRole.arn },
          containers: withTelemetry(BASE_NAME, {
            service: {
              name: 'service',
              image: image.image.imageUri,
              stopTimeout: 10,
              cpu: 256,
              // A 32 MB upload expands several times as JSON while it is
              // redacted and compressed.
              memory: 1024,
              environment: [
                { name: 'ENVIRONMENT', value: stack },
                { name: 'DD_SERVICE', value: BASE_NAME },
                { name: 'DD_ENV', value: stack },
                versionEnvironment(image.image.imageUri),
                { name: 'RUST_BACKTRACE', value: '1' },
              ],
              secrets: [...dopplerEcsEnvironment.containerSecrets],
              logConfiguration: {
                logDriver: 'awsfirelens',
                options: {
                  Name: 'datadog',
                  Host: 'http-intake.logs.us5.datadoghq.com',
                  apikey: DATADOG_API_KEY,
                  dd_service: BASE_NAME,
                  dd_source: 'fargate',
                  dd_tags: `project:cloudstorage, env:${stack}`,
                  provider: 'ecs',
                },
              },
              portMappings: [
                {
                  appProtocol: 'http',
                  name: `${BASE_NAME}-tcp-${stack}`,
                  hostPort: CONTAINER_PORT,
                  containerPort: CONTAINER_PORT,
                  targetGroup,
                },
              ],
            },
          }),
          runtimePlatform: {
            operatingSystemFamily: 'LINUX',
            cpuArchitecture: 'X86_64',
          },
        },
        desiredCount: 1,
      },
      {
        parent: this,
        // ECS rejects a target group not yet attached to a listener; the
        // listener rule makes that attachment. Tasks also wait for their
        // Doppler values, since config is loaded once at startup.
        dependsOn: [gatewayTargetGroup.listener_rule, ...configurationSecrets],
      }
    );

    this.setupAutoScaling(ecsClusterName, targetGroup);
    this.setupServiceAlarms(ecsClusterName, targetGroup);
  }

  private setupAutoScaling(
    ecsClusterName: pulumi.Output<string> | string,
    targetGroup: aws.lb.TargetGroup
  ) {
    const target = new aws.appautoscaling.Target(
      `${BASE_NAME}-service-scalable-target-${stack}`,
      {
        maxCapacity: 2,
        minCapacity: 1,
        resourceId: pulumi.interpolate`service/${ecsClusterName}/${this.service.service.name}`,
        scalableDimension: 'ecs:service:DesiredCount',
        serviceNamespace: 'ecs',
      },
      { parent: this }
    );

    const policies: {
      name: string;
      metric: string;
      targetValue: number;
      resourceLabel?: pulumi.Input<string>;
      scaleInCooldown: number;
      scaleOutCooldown: number;
    }[] = [
      {
        name: 'request-count',
        metric: 'ALBRequestCountPerTarget',
        targetValue: 1000,
        resourceLabel: pulumi.interpolate`${gatewayLoadBalancer.albArnSuffix}/${targetGroup.arnSuffix}`,
        scaleInCooldown: 60,
        scaleOutCooldown: 120,
      },
      {
        name: 'cpu',
        metric: 'ECSServiceAverageCPUUtilization',
        targetValue: 70,
        scaleInCooldown: 100,
        scaleOutCooldown: 300,
      },
      {
        name: 'memory',
        metric: 'ECSServiceAverageMemoryUtilization',
        targetValue: 70,
        scaleInCooldown: 100,
        scaleOutCooldown: 300,
      },
    ];
    for (const policy of policies) {
      new aws.appautoscaling.Policy(
        `${BASE_NAME}-scaling-policy-${policy.name}-${stack}`,
        {
          policyType: 'TargetTrackingScaling',
          resourceId: target.resourceId,
          scalableDimension: target.scalableDimension,
          serviceNamespace: target.serviceNamespace,
          targetTrackingScalingPolicyConfiguration: {
            targetValue: policy.targetValue,
            predefinedMetricSpecification: {
              predefinedMetricType: policy.metric,
              resourceLabel: policy.resourceLabel,
            },
            scaleInCooldown: policy.scaleInCooldown,
            scaleOutCooldown: policy.scaleOutCooldown,
          },
        },
        { parent: this }
      );
    }
  }

  private setupServiceAlarms(
    ecsClusterName: pulumi.Output<string> | string,
    targetGroup: aws.lb.TargetGroup
  ) {
    const tags = { environment: stack, project: BASE_NAME };

    new EcsDeploymentFailureAlarm(
      `${BASE_NAME}-deployment-failure-alarm`,
      {
        serviceName: BASE_NAME,
        serviceArn: this.service.service.arn,
        tags,
      },
      { parent: this }
    );

    for (const [name, metricName, label] of [
      ['high-cpu', 'CPUUtilization', 'CPU'],
      ['high-mem', 'MemoryUtilization', 'Memory'],
    ]) {
      new aws.cloudwatch.MetricAlarm(
        `${BASE_NAME}-${name}-alarm`,
        {
          name: `${BASE_NAME}-${name}-alarm-${stack}`,
          metricName,
          namespace: 'AWS/ECS',
          statistic: 'Average',
          period: 180,
          evaluationPeriods: 1,
          threshold: 80,
          comparisonOperator: 'GreaterThanThreshold',
          dimensions: {
            ClusterName: ecsClusterName,
            ServiceName: this.service.service.name,
          },
          alarmDescription: `High ${label} usage alarm for ${BASE_NAME} service.`,
          actionsEnabled: true,
          alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
          tags,
        },
        { parent: this }
      );
    }

    new aws.cloudwatch.MetricAlarm(
      `${BASE_NAME}-http-5xx-alarm`,
      {
        name: `${BASE_NAME}-http-5xx-${stack}`,
        metricName: 'HTTPCode_Target_5XX_Count',
        namespace: 'AWS/ApplicationELB',
        statistic: 'Sum',
        period: 180,
        evaluationPeriods: 1,
        threshold: 25,
        comparisonOperator: 'GreaterThanOrEqualToThreshold',
        dimensions: {
          LoadBalancer: gatewayLoadBalancer.albArnSuffix,
          TargetGroup: targetGroup.arnSuffix,
        },
        alarmDescription: `High HTTP 5XX count alarm for ${BASE_NAME} gateway target group.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags,
      },
      { parent: this }
    );
  }
}
