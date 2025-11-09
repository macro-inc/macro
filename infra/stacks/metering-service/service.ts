import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import {
  DATADOG_API_KEY,
  datadogAgentContainer,
  fargateLogRouterSidecarContainer,
  serviceLoadBalancer,
} from '@resources';
import { EcrImage } from '@service';
import { BASE_DOMAIN, CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '@shared';

const toSnakeCase = (...parts: String[]) => parts.join('_');
//const capitalize = (word: String) => word[0].toUpperCase() + word.slice(1)
//const toCamelCase = (first: String, ...rest: String[]) => [first, ...rest.map(capitalize)].join('')
const toKebabCase = (...parts: String[]) => parts.join('-');

// name of of the "project". Usually the thing before "_service".
const PROJECT = 'metering';
const KEBAB_BASE_NAME = toKebabCase(PROJECT, 'service');
// directory name of service
const SNAKE_BASE_NAME = toSnakeCase(PROJECT, 'service');
const SERVICE_DIR_NAME = SNAKE_BASE_NAME;
const BASE_PATH = '../../../rust/cloud-storage';

export const SERVICE_DOMAIN_NAME = `${PROJECT}${stack === 'prod' ? '' : `-${stack}`}.${BASE_DOMAIN}`;

type CreateServiceArgs = {
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
};

export class Service extends pulumi.ComponentResource {
  public role: aws.iam.Role;
  public ecr: awsx.ecr.Repository;
  public serviceAlbSg: aws.ec2.SecurityGroup;
  public serviceSg: aws.ec2.SecurityGroup;
  public domain: string;
  public tags: { [key: string]: string };
  public targetGroup: aws.lb.TargetGroup;
  public lb: aws.lb.LoadBalancer;
  public listener: aws.lb.Listener;
  public service: awsx.ecs.FargateService;
  public cloudStorageClusterName: pulumi.Output<string> | string;

  constructor(
    name: string,
    {
      vpc,
      tags,
      platform,
      serviceContainerPort,
      healthCheckPath,
      isPrivate,
      ecsClusterArn,
      containerEnvVars,
      cloudStorageClusterName,
    }: CreateServiceArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super(`my:components:${PROJECT}Service`, name, {}, opts);
    this.domain = `https://${SERVICE_DOMAIN_NAME}`;
    this.tags = tags;
    this.cloudStorageClusterName = cloudStorageClusterName;

    this.role = new aws.iam.Role(
      `${KEBAB_BASE_NAME}-role`,
      {
        name: `${KEBAB_BASE_NAME}-role-${stack}`,
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
        tags: this.tags,
        managedPolicyArns: [],
      },
      { parent: this }
    );

    // ecr image
    const image = new EcrImage(
      `${KEBAB_BASE_NAME}-ecr-image-${stack}`,
      {
        repositoryId: `${KEBAB_BASE_NAME}-ecr-${stack}`,
        repositoryName: `${KEBAB_BASE_NAME}-${stack}`,
        imageId: `${KEBAB_BASE_NAME}-image-${stack}`,
        imagePath: BASE_PATH,
        dockerfile: 'Dockerfile',
        platform,
        buildArgs: {
          SERVICE_NAME: `${PROJECT}_service`,
        },
        tags: this.tags,
      },
      { parent: this }
    );
    this.ecr = image.ecr;

    // Security groups
    const sg = this.initializeSecurityGroups({
      vpcId: vpc.vpcId,
      serviceContainerPort,
    });
    this.serviceAlbSg = sg.serviceAlbSg;
    this.serviceSg = sg.serviceSg;

    // Load balancer
    const { targetGroup, lb, listener } = serviceLoadBalancer(this, {
      serviceName: KEBAB_BASE_NAME, // service name
      serviceContainerPort,
      healthCheckPath,
      vpc,
      albSecurityGroupId: this.serviceAlbSg.id,
      isPrivate,
      tags,
    });
    this.targetGroup = targetGroup;
    this.lb = lb;
    this.listener = listener;

    // Fargate Service
    const service = new awsx.ecs.FargateService(
      `${KEBAB_BASE_NAME}`,
      {
        tags,
        cluster: ecsClusterArn,
        networkConfiguration: {
          subnets: vpc.privateSubnetIds,
          securityGroups: [this.serviceSg.id],
        },
        taskDefinitionArgs: {
          taskRole: {
            roleArn: this.role.arn,
          },
          containers: {
            log_router: fargateLogRouterSidecarContainer,
            datadog_agent: datadogAgentContainer,
            service: {
              name: SERVICE_DIR_NAME,
              image: image.image.imageUri,
              cpu: stack === 'prod' ? 512 : 256,
              memory: stack === 'prod' ? 1024 : 512,
              environment: [
                ...containerEnvVars,
                {
                  name: 'BASE_URL',
                  value: this.domain,
                },
              ],
              logConfiguration: {
                logDriver: 'awsfirelens',
                options: {
                  Name: 'datadog',
                  Host: 'http-intake.logs.us5.datadoghq.com',
                  apikey: DATADOG_API_KEY,
                  dd_service: `${PROJECT}-service-${stack}`,
                  dd_source: 'fargate',
                  dd_tags: `project:${PROJECT}, env:${stack}`,
                  provider: 'ecs',
                },
              },
              portMappings: [
                {
                  appProtocol: 'http',
                  name: `${KEBAB_BASE_NAME}-tcp-${stack}`,
                  hostPort: serviceContainerPort,
                  containerPort: serviceContainerPort,
                  targetGroup,
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
      { parent: this }
    );
    this.service = service;

    // auto-scaling and alarm notifications
    this.setupAutoScaling();
    this.setupServiceAlarms();

    // DNS
    const zone = aws.route53.getZoneOutput({ name: BASE_DOMAIN });

    new aws.route53.Record(
      `${KEBAB_BASE_NAME}-domain-record`,
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

  initializeSecurityGroups({
    vpcId,
    serviceContainerPort,
  }: {
    vpcId: pulumi.Output<string> | string;
    serviceContainerPort: number;
  }) {
    const serviceAlbSg = new aws.ec2.SecurityGroup(
      `${KEBAB_BASE_NAME}-alb-sg-${stack}`,
      {
        name: `${KEBAB_BASE_NAME}-alb-sg-${stack}`,
        description: `${PROJECT} application load balancer security group`,
        vpcId,
        tags: this.tags,
      },
      { parent: this }
    );

    const serviceSg = new aws.ec2.SecurityGroup(
      `${KEBAB_BASE_NAME}-sg-${stack}`,
      {
        name: `${KEBAB_BASE_NAME}-sg-${stack}`,
        vpcId,
        description: `${PROJECT} security group that is attached directly to the service`,
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupIngressRule(
      `${KEBAB_BASE_NAME}-alb-in`,
      {
        securityGroupId: serviceSg.id,
        description: 'Allow inbound traffic from the services ALB',
        referencedSecurityGroupId: serviceAlbSg.id,
        fromPort: serviceContainerPort,
        toPort: serviceContainerPort,
        ipProtocol: 'tcp',
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupEgressRule(
      `${KEBAB_BASE_NAME}-all-out`,
      {
        securityGroupId: serviceSg.id,
        description: 'Allow all outbound',
        cidrIpv4: '0.0.0.0/0',
        ipProtocol: '-1',
        tags: this.tags,
      },
      { parent: this }
    );

    // ALB SG rules
    new aws.vpc.SecurityGroupIngressRule(
      `${KEBAB_BASE_NAME}-http`,
      {
        securityGroupId: serviceAlbSg.id,
        description: 'Allow inbound HTTP traffic',
        cidrIpv4: '0.0.0.0/0',
        fromPort: 80,
        ipProtocol: 'tcp',
        toPort: 80,
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupIngressRule(
      `${KEBAB_BASE_NAME}-https`,
      {
        securityGroupId: serviceAlbSg.id,
        description: 'Allow inbound HTTPS traffic',
        cidrIpv4: '0.0.0.0/0',
        fromPort: 443,
        ipProtocol: 'tcp',
        toPort: 443,
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupEgressRule(
      `${KEBAB_BASE_NAME}-out-service`,
      {
        description: 'Allow traffic to the service security group',
        securityGroupId: serviceAlbSg.id,
        referencedSecurityGroupId: serviceSg.id,
        fromPort: serviceContainerPort,
        ipProtocol: 'tcp',
        toPort: serviceContainerPort,
        tags: this.tags,
      },
      { parent: this }
    );

    return { serviceAlbSg, serviceSg };
  }

  setupAutoScaling() {
    if (!this.service) return;

    const serviceScalableTarget = new aws.appautoscaling.Target(
      `${KEBAB_BASE_NAME}-service-scalable-target-${stack}`,
      {
        maxCapacity: stack === 'prod' ? 10 : 3,
        minCapacity: 1,
        resourceId: pulumi.interpolate`service/${this.cloudStorageClusterName}/${this.service.service.name}`,
        scalableDimension: 'ecs:service:DesiredCount',
        serviceNamespace: 'ecs',
        tags: this.tags,
      },
      { parent: this }
    );

    const lbPortion: pulumi.Output<string> = this.lb.arn.apply((arn) => {
      const parts = arn.split(':loadbalancer/');
      return parts[1];
    });

    const tgPortion: pulumi.Output<string> = this.targetGroup.arn.apply(
      (arn) => {
        const parts = arn.split(':');
        return parts[parts.length - 1];
      }
    );

    const resourceLabel = pulumi.interpolate`${lbPortion}/${tgPortion}`;

    // Create an Auto Scaling policy for request count.
    new aws.appautoscaling.Policy(
      `${KEBAB_BASE_NAME}-scaling-policy-request-count-${stack}`,
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
      `${KEBAB_BASE_NAME}-scaling-policy-cpu-${stack}`,
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
      `${KEBAB_BASE_NAME}-scaling-policy-memory-${stack}`,
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
    new aws.cloudwatch.MetricAlarm(
      `${KEBAB_BASE_NAME}-high-cpu-alarm`,
      {
        name: `${KEBAB_BASE_NAME}-high-cpu-alarm-${stack}`,
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
        alarmDescription: `High CPU usage alarm for ${PROJECT} service.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.cloudwatch.MetricAlarm(
      `${KEBAB_BASE_NAME}-high-mem-alarm`,
      {
        name: `${KEBAB_BASE_NAME}-high-mem-alarm-${stack}`,
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
        alarmDescription: `High Memory usage alarm for ${PROJECT} service.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.cloudwatch.MetricAlarm(
      `${KEBAB_BASE_NAME}-http-5xx-alarm`,
      {
        name: `${KEBAB_BASE_NAME}-http-5xx-${stack}`,
        metricName: 'HTTPCode_ELB_5XX_Count',
        namespace: 'AWS/ApplicationELB',
        statistic: 'Sum',
        period: 180,
        evaluationPeriods: 1,
        threshold: 25,
        comparisonOperator: 'GreaterThanOrEqualToThreshold',
        dimensions: {
          LoadBalancer: this.lb.arn,
        },
        alarmDescription: `High HTTP 5XX count alarm for ${PROJECT} Load Balancer.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this }
    );
  }
}
