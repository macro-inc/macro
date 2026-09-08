import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import {
  DATADOG_API_KEY,
  DEFAULT_CONTINUE_BEFORE_STEADY_STATE,
  EcsDeploymentFailureAlarm,
  datadogAgentContainer,
  fargateLogRouterSidecarContainer,
  ServiceTargetGroup,
} from '../../packages/resources';
import { EcrImage } from '../../packages/service';
import {
  CLOUD_TRAIL_SNS_TOPIC_ARN,
  type DopplerEcsEnvironment,
  getGatewayAlb,
  getServiceUrl,
  GatewayService,
  ServiceUrl,
  stack,
} from '../../packages/shared';

const gatewayLoadBalancer = getGatewayAlb();

const BASE_NAME = 'email-service';
const REPO_ROOT = '../../..';

type Args = {
  role: aws.iam.Role;
  clusterName: pulumi.Output<string> | string;
  ecsClusterArn: pulumi.Output<string> | string;
  vpc: {
    vpcId: pulumi.Output<string> | string;
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  platform: { family: string; architecture: 'amd64' | 'arm64' };
  serviceContainerPort: number;
  containerEnvVars: { name: string; value: pulumi.Output<string> | string }[];
  healthCheckPath: string;
  tags: { [key: string]: string };
  dopplerEcsEnvironment: DopplerEcsEnvironment;
};

export class EmailService extends pulumi.ComponentResource {
  public role: aws.iam.Role;
  public ecr: awsx.ecr.Repository;
  public serviceSg: aws.ec2.SecurityGroup;
  public targetGroup: aws.lb.TargetGroup;
  public service: awsx.ecs.FargateService;
  public domain: string;
  public clusterName: pulumi.Output<string> | string;
  public tags: { [key: string]: string };

  constructor(
    name: string,
    {
      role,
      ecsClusterArn,
      vpc,
      platform,
      serviceContainerPort,
      healthCheckPath,
      containerEnvVars,
      clusterName,
      dopplerEcsEnvironment,
      tags,
    }: Args,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:Service', name, {}, opts);
    this.tags = tags;

    this.clusterName = clusterName;
    this.role = role;

    // ecr image
    const image = new EcrImage(
      `${BASE_NAME}-ecr-image-${stack}`,
      {
        repositoryId: `${BASE_NAME}-ecr-${stack}`,
        repositoryName: `${BASE_NAME}-${stack}`,
        imageId: `${BASE_NAME}-image-${stack}`,
        imagePath: REPO_ROOT,
        dockerfile: 'docker/Dockerfile',
        platform,
        tags: this.tags,
        buildArgs: {
          SERVICE_NAME: 'email_service',
        },
      },
      { parent: this }
    );
    this.ecr = image.ecr;

    // sg
    this.serviceSg = this.initializeSecurityGroups({ vpcId: vpc.vpcId });

    const gatewayTargetGroup = new ServiceTargetGroup(
      `${stack}-${BASE_NAME}`,
      {
        tags: this.tags,
        listenerArn: gatewayLoadBalancer.httpsListenerArn,
        vpcId: vpc.vpcId,
        containerPort: serviceContainerPort,
        service: GatewayService.EMAIL_SERVICE,
        healthCheckPath,
        pathPatterns: ['/email', '/email/*'],
        serviceSecurityGroupId: this.serviceSg.id,
        albSecurityGroupId: gatewayLoadBalancer.albSecurityGroupId,
      },
      { parent: this }
    );

    this.targetGroup = gatewayTargetGroup.target_group;

    // service
    const service = new awsx.ecs.FargateService(
      `${BASE_NAME}`,
      {
        tags,
        cluster: ecsClusterArn,
        networkConfiguration: {
          subnets: vpc.privateSubnetIds,
          securityGroups: [this.serviceSg.id],
        },
        continueBeforeSteadyState: DEFAULT_CONTINUE_BEFORE_STEADY_STATE,
        deploymentCircuitBreaker: {
          enable: true,
          rollback: true,
        },
        // Register tasks only with the shared gateway.
        loadBalancers: [
          {
            targetGroupArn: gatewayTargetGroup.target_group.arn,
            containerName: 'service',
            containerPort: serviceContainerPort,
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
              stopTimeout: 10, // 10 seconds to force kill the task
              cpu: stack === 'prod' ? 1024 : 256,
              memory: stack === 'prod' ? 4096 : 717,
              environment: [...containerEnvVars],
              secrets: [...dopplerEcsEnvironment.containerSecrets],
              logConfiguration: {
                logDriver: 'awsfirelens',
                options: {
                  Name: 'datadog',
                  Host: 'http-intake.logs.us5.datadoghq.com',
                  apikey: DATADOG_API_KEY,
                  dd_service: 'email-service',
                  dd_source: 'fargate',
                  dd_tags: `project:cloudstorage, env:${stack}`,
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
              ],
            },
          },
          runtimePlatform: {
            operatingSystemFamily: `${platform.family.toUpperCase()}`,
            cpuArchitecture: `${
              platform.architecture === 'amd64'
                ? 'X86_64'
                : platform.architecture.toUpperCase()
            }`,
          },
        },
        desiredCount: stack === 'prod' ? 3 : 1,
      },
      {
        parent: this,
        // ECS refuses a service whose target group is not yet associated with
        // a load balancer; it is the listener rule that creates that
        // association
        dependsOn: [gatewayTargetGroup.listener_rule],
      }
    );

    this.service = service;

    this.setupAutoScaling({
      gatewayAlbArnSuffix: gatewayLoadBalancer.albArnSuffix,
      gatewayTargetGroup: gatewayTargetGroup.target_group,
    });

    this.setupServiceAlarms();

    this.domain = getServiceUrl(ServiceUrl.EMAIL_SERVICE_URL);
  }

  initializeSecurityGroups({
    vpcId,
  }: {
    vpcId: pulumi.Output<string> | string;
  }): aws.ec2.SecurityGroup {
    const serviceSg = new aws.ec2.SecurityGroup(
      `${BASE_NAME}-sg-${stack}`,
      {
        name: `${BASE_NAME}-sg-${stack}`,
        vpcId,
        description: `${BASE_NAME} security group that is attached directly to the service`,
        tags: this.tags,
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
        tags: this.tags,
      },
      { parent: this }
    );

    return serviceSg;
  }

  setupAutoScaling({
    gatewayAlbArnSuffix,
    gatewayTargetGroup,
  }: {
    gatewayAlbArnSuffix: pulumi.Output<string>;
    gatewayTargetGroup: aws.lb.TargetGroup;
  }) {
    if (!this.service) return;

    const serviceScalableTarget = new aws.appautoscaling.Target(
      `${BASE_NAME}-service-scalable-target-${stack}`,
      {
        maxCapacity: stack === 'prod' ? 10 : 2,
        minCapacity: stack === 'prod' ? 3 : 1,
        resourceId: pulumi.interpolate`service/${this.clusterName}/${this.service.service.name}`,
        scalableDimension: 'ecs:service:DesiredCount',
        serviceNamespace: 'ecs',
        tags: this.tags,
      },
      { parent: this }
    );

    const resourceLabel = pulumi.interpolate`${gatewayAlbArnSuffix}/${gatewayTargetGroup.arnSuffix}`;

    // Create an Auto Scaling policy for request count.
    new aws.appautoscaling.Policy(
      `${BASE_NAME}-scaling-policy-request-count-${stack}`,
      {
        policyType: 'TargetTrackingScaling',
        resourceId: serviceScalableTarget.resourceId,
        scalableDimension: serviceScalableTarget.scalableDimension,
        serviceNamespace: serviceScalableTarget.serviceNamespace,
        targetTrackingScalingPolicyConfiguration: {
          targetValue: 1000, // TODO: play with this
          predefinedMetricSpecification: {
            predefinedMetricType: 'ALBRequestCountPerTarget',
            resourceLabel,
          },
          scaleInCooldown: 60,
          scaleOutCooldown: 120,
        },
      },
      { parent: this }
    );

    // Create an Auto Scaling policy for CPU utilization.
    new aws.appautoscaling.Policy(
      `${BASE_NAME}-scaling-policy-cpu-${stack}`,
      {
        policyType: 'TargetTrackingScaling',
        resourceId: serviceScalableTarget.resourceId,
        scalableDimension: serviceScalableTarget.scalableDimension,
        serviceNamespace: serviceScalableTarget.serviceNamespace,
        targetTrackingScalingPolicyConfiguration: {
          targetValue: 70.0,
          predefinedMetricSpecification: {
            predefinedMetricType: 'ECSServiceAverageCPUUtilization',
          },
          scaleInCooldown: 100,
          scaleOutCooldown: 300,
        },
      },
      { parent: this }
    );

    new aws.appautoscaling.Policy(
      `${BASE_NAME}-scaling-policy-memory-${stack}`,
      {
        policyType: 'TargetTrackingScaling',
        resourceId: serviceScalableTarget.resourceId,
        scalableDimension: serviceScalableTarget.scalableDimension,
        serviceNamespace: serviceScalableTarget.serviceNamespace,
        targetTrackingScalingPolicyConfiguration: {
          targetValue: 70.0,
          predefinedMetricSpecification: {
            predefinedMetricType: 'ECSServiceAverageMemoryUtilization',
          },
          scaleInCooldown: 100,
          scaleOutCooldown: 300,
        },
      },
      { parent: this }
    );
  }

  setupServiceAlarms() {
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
      `${BASE_NAME}-high-cpu-alarm`,
      {
        name: `${BASE_NAME}-high-cpu-alarm-${stack}`,
        metricName: 'CPUUtilization',
        namespace: 'AWS/ECS',
        statistic: 'Average',
        period: 180,
        evaluationPeriods: 1,
        threshold: 80,
        comparisonOperator: 'GreaterThanThreshold',
        dimensions: {
          ClusterName: this.clusterName,
          ServiceName: this.service.service.name,
        },
        alarmDescription: `High CPU usage alarm for ${BASE_NAME} service.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.cloudwatch.MetricAlarm(
      `${BASE_NAME}-high-mem-alarm`,
      {
        name: `${BASE_NAME}-high-mem-alarm-${stack}`,
        metricName: 'MemoryUtilization',
        namespace: 'AWS/ECS',
        statistic: 'Average',
        period: 180,
        evaluationPeriods: 1,
        threshold: 80,
        comparisonOperator: 'GreaterThanThreshold',
        dimensions: {
          ClusterName: this.clusterName,
          ServiceName: this.service.service.name,
        },
        alarmDescription: `High Memory usage alarm for ${BASE_NAME} service.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this }
    );

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
          TargetGroup: this.targetGroup.arnSuffix,
        },
        alarmDescription: `High HTTP 5XX count alarm for ${BASE_NAME} gateway target group.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this }
    );
  }
}
