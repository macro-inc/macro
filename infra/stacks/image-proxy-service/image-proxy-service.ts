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
  DopplerEcsEnvironment,
  getGatewayAlb,
  GatewayService,
  stack,
} from '../../packages/shared';

const gatewayLoadBalancer = getGatewayAlb();

const BASE_NAME = pulumi.getProject();
const REPO_ROOT = '../../..';

type CreateImageProxyServiceArgs = {
  cloudStorageClusterName: pulumi.Output<string> | string;
  ecsClusterArn: pulumi.Output<string> | string;
  vpc: {
    vpcId: pulumi.Output<string> | string;
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  platform: { family: string; architecture: 'amd64' | 'arm64' };
  serviceContainerPort: number;
  containerEnvVars?: { name: string; value: pulumi.Output<string> | string }[];
  healthCheckPath: string;
  secretKeyArns: (pulumi.Output<string> | string)[];
  tags: { [key: string]: string };
};

export class ImageProxyService extends pulumi.ComponentResource {
  public ecr: awsx.ecr.Repository;
  public serviceSg: aws.ec2.SecurityGroup;
  public targetGroup: aws.lb.TargetGroup;
  public service: awsx.ecs.FargateService;
  public cloudStorageClusterName: pulumi.Output<string> | string;
  public tags: { [key: string]: string };
  public role: aws.iam.Role;

  constructor(
    name: string,
    {
      ecsClusterArn,
      vpc,
      platform,
      serviceContainerPort,
      healthCheckPath,
      containerEnvVars,
      cloudStorageClusterName,
      secretKeyArns,
      tags,
    }: CreateImageProxyServiceArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:ImageProxyService', name, {}, opts);
    this.tags = tags;

    this.cloudStorageClusterName = cloudStorageClusterName;

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
        buildArgs: {
          SERVICE_NAME: 'image_proxy_service',
        },
        tags: this.tags,
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
        service: GatewayService.IMAGE_PROXY_SERVICE,
        healthCheckPath,
        pathPatterns: ['/image-proxy', '/image-proxy/*'],
        serviceSecurityGroupId: this.serviceSg.id,
        albSecurityGroupId: gatewayLoadBalancer.albSecurityGroupId,
      },
      { parent: this }
    );

    this.targetGroup = gatewayTargetGroup.target_group;

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
              Sid: '',
            },
          ],
        },
        managedPolicyArns: [],
        tags: this.tags,
      },
      { parent: this }
    );

    // Secrets Manager access for JWT validation
    const secretsPolicy = new aws.iam.Policy(
      `${BASE_NAME}-secrets-policy`,
      {
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: ['secretsmanager:GetSecretValue'],
              Resource: [...secretKeyArns],
              Effect: 'Allow',
            },
          ],
        },
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.iam.RolePolicyAttachment(
      `${BASE_NAME}-secrets-policy-attachment`,
      {
        role: this.role.name,
        policyArn: secretsPolicy.arn,
      },
      { parent: this }
    );

    const dopplerEcsEnvironment = new DopplerEcsEnvironment(
      BASE_NAME,
      { tags: this.tags },
      { parent: this }
    );

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
              stopTimeout: 10,
              cpu: 512,
              memory: 1024,
              environment: containerEnvVars,
              secrets: [...dopplerEcsEnvironment.containerSecrets],
              logConfiguration: {
                logDriver: 'awsfirelens',
                options: {
                  Name: 'datadog',
                  Host: 'http-intake.logs.us5.datadoghq.com',
                  apikey: DATADOG_API_KEY,
                  dd_service: 'image-proxy-service',
                  dd_source: 'fargate',
                  dd_tags: `project:image-proxy-service, env:${stack}`,
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
        desiredCount: 1,
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
        maxCapacity: stack === 'prod' ? 15 : 3,
        minCapacity: 1,
        resourceId: pulumi.interpolate`service/${this.cloudStorageClusterName}/${this.service.service.name}`,
        scalableDimension: 'ecs:service:DesiredCount',
        serviceNamespace: 'ecs',
        tags: this.tags,
      },
      { parent: this }
    );

    const resourceLabel = pulumi.interpolate`${gatewayAlbArnSuffix}/${gatewayTargetGroup.arnSuffix}`;

    new aws.appautoscaling.Policy(
      `${BASE_NAME}-scaling-policy-request-count-${stack}`,
      {
        policyType: 'TargetTrackingScaling',
        resourceId: serviceScalableTarget.resourceId,
        scalableDimension: serviceScalableTarget.scalableDimension,
        serviceNamespace: serviceScalableTarget.serviceNamespace,
        targetTrackingScalingPolicyConfiguration: {
          targetValue: 1000,
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
          ClusterName: this.cloudStorageClusterName,
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
          ClusterName: this.cloudStorageClusterName,
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
