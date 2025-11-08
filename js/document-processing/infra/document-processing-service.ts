import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import {
  DATADOG_API_KEY,
  datadogAgentContainer,
  fargateLogRouterSidecarContainer,
} from './datadog';
import { EcrImage } from './resources/image';
import { createApplicationLoadBalancer } from './resources/load_balancer';
import { createServiceSecurityGroups } from './resources/security_groups';
import {
  BASE_DOMAIN,
  CLOUD_TRAIL_SNS_TOPIC_ARN,
  stack,
} from './resources/shared';

const BASE_NAME = 'document-processing';
const BASE_PATH = '../';
const PRODUCER_SERVICE_PATH = `${BASE_PATH}/producer-service`;
const CONSUMER_SERVICE_PATH = `${BASE_PATH}/consumer-service`;
export const SERVICE_DOMAIN_NAME = `${BASE_NAME}${
  stack !== 'prod' ? `-${stack}` : ''
}.${BASE_DOMAIN}`;

type CreateDocumentProcessingServiceArgs = {
  ecsClusterArn: pulumi.Output<string> | string;
  cloudStorageClusterName: pulumi.Output<string> | string;
  vpc: {
    vpcId: pulumi.Output<string> | string;
    publicSubnetIds: pulumi.Output<string[]> | string[];
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  producerServiceEnvVars?: {
    name: string;
    value: pulumi.Output<string> | string;
  }[];
  consumerServiceEnvVars?: {
    name: string;
    value: pulumi.Output<string> | string;
  }[];
  platform: { family: string; architecture: 'amd64' | 'arm64' };
  documentStorageBucketArn: pulumi.Output<string> | string;
  jobUpdateHandlerLambdaArn: pulumi.Output<string> | string;
  pdfPreprocessLambdaArn: pulumi.Output<string> | string;
  tags: { [key: string]: string };
};

export class DocumentProcessingService extends pulumi.ComponentResource {
  // ECR repository for the producer service
  public producerEcr: awsx.ecr.Repository;
  // ECR repository for the consumer service
  public consumerEcr: awsx.ecr.Repository;
  // Producer docker image
  public producerImage: awsx.ecr.Image;
  // Consumer docker image
  public consumerImage: awsx.ecr.Image;
  // IAM role for the service
  public role: aws.iam.Role;
  // Application Load Balancer
  public applicationLoadBalancer: aws.lb.LoadBalancer;
  // Security group for the application load balancer
  public applicationLoadBalancerSecurityGroup: aws.ec2.SecurityGroup;
  // Security group for the service
  public serviceSecurityGroup: aws.ec2.SecurityGroup;
  // Target group for the service
  public targetGroup: aws.lb.TargetGroup;
  // Listener for the target group
  public listener: aws.lb.Listener;
  // Fargate service for the producer/consumer
  public service: awsx.ecs.FargateService;
  // The domain for the service
  public domain: string;
  // The name of the cloud storage cluster
  public cloudStorageClusterName: pulumi.Output<string> | string;
  // Tags for the service
  public tags: { [key: string]: string };

  constructor(
    name: string,
    {
      ecsClusterArn,
      documentStorageBucketArn,
      jobUpdateHandlerLambdaArn,
      pdfPreprocessLambdaArn,
      vpc,
      platform,
      producerServiceEnvVars,
      consumerServiceEnvVars,
      cloudStorageClusterName,
      tags,
    }: CreateDocumentProcessingServiceArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:ProducerConsumerService', name, {}, opts);

    this.tags = tags;
    this.cloudStorageClusterName = cloudStorageClusterName;

    const producerImage = new EcrImage(
      `${BASE_NAME}-producer-ecr-image-${stack}`,
      {
        repositoryId: `${BASE_NAME}-producer-ecr-${stack}`,
        repositoryName: `${BASE_NAME}-producer-${stack}`,
        imageId: `${BASE_NAME}-producer-image-${stack}`,
        imagePath: PRODUCER_SERVICE_PATH,
        platform,
        tags: this.tags,
      },
      { parent: this }
    );
    this.producerEcr = producerImage.ecr;
    this.producerImage = producerImage.image;

    const consumerImage = new EcrImage(
      `${BASE_NAME}-consumer-ecr-image-${stack}`,
      {
        repositoryId: `${BASE_NAME}-consumer-ecr-${stack}`,
        repositoryName: `${BASE_NAME}-consumer-${stack}`,
        imageId: `${BASE_NAME}-consumer-image-${stack}`,
        imagePath: CONSUMER_SERVICE_PATH,
        platform,
        tags: this.tags,
      },
      { parent: this }
    );

    this.consumerEcr = consumerImage.ecr;
    this.consumerImage = consumerImage.image;

    const docStorageBucketPolicy = new aws.iam.Policy(
      `${BASE_NAME}-doc-storage-policy-${stack}`,
      {
        name: `${BASE_NAME}-doc-storage-bucket-policy-${stack}`,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: ['s3:GetObject', 's3:PutObject'],
              Resource: [
                documentStorageBucketArn,
                pulumi.interpolate`${documentStorageBucketArn}/*`,
              ],
              Effect: 'Allow',
            },
          ],
        },
        tags: this.tags,
      },
      { parent: this }
    );

    const lambdaInvoke = new aws.iam.Policy(
      `${BASE_NAME}-lambda-invoke-policy-${stack}`,
      {
        name: `${BASE_NAME}-lambda-invoke-policy-${stack}`,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: ['lambda:InvokeFunction'],
              Resource: [jobUpdateHandlerLambdaArn, pdfPreprocessLambdaArn],
              Effect: 'Allow',
            },
          ],
        },
        tags: this.tags,
      },
      { parent: this }
    );

    this.role = new aws.iam.Role(
      `${BASE_NAME}-role-${stack}`,
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
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.iam.RolePolicyAttachment(
      `${BASE_NAME}-role-doc-storage-att-${stack}`,
      {
        role: this.role,
        policyArn: docStorageBucketPolicy.arn,
      }
    );

    new aws.iam.RolePolicyAttachment(
      `${BASE_NAME}-role-lambda-invoke-att-${stack}`,
      {
        role: this.role,
        policyArn: lambdaInvoke.arn,
      }
    );

    const securityGroups = createServiceSecurityGroups(this, {
      name: BASE_NAME,
      vpcId: vpc.vpcId,
      serviceContainerPort: 8080,
      tags: this.tags,
    });

    this.applicationLoadBalancerSecurityGroup = securityGroups.serviceAlbSg;
    this.serviceSecurityGroup = securityGroups.serviceSg;

    const listener = createApplicationLoadBalancer(this, {
      name: BASE_NAME,
      vpc,
      albSecurityGroupId: this.applicationLoadBalancerSecurityGroup.id,
      serviceContainerPort: 8080,
      isPrivate: true,
      healthCheckPath: '/health',
      tags: this.tags,
    });

    this.targetGroup = listener.targetGroup;
    this.applicationLoadBalancer = listener.lb;
    this.listener = listener.listener;

    const updatedConsumerServiceEnvVars = consumerServiceEnvVars ?? [];

    updatedConsumerServiceEnvVars.push({
      name: 'NODE_OPTIONS',
      // Dynamic max heap size based on the stack
      // memory - 512 leaving the half gb for the container
      value: `--max-old-space-size=${stack === 'dev' ? 2560 : 3584}`,
    });

    this.service = new awsx.ecs.FargateService(
      `${BASE_NAME}-${stack}`,
      {
        tags,
        cluster: ecsClusterArn,
        networkConfiguration: {
          subnets: vpc.privateSubnetIds,
          securityGroups: [this.serviceSecurityGroup.id],
        },
        taskDefinitionArgs: {
          taskRole: {
            roleArn: this.role.arn,
          },
          containers: {
            log_router: fargateLogRouterSidecarContainer,
            datadog_agent: datadogAgentContainer,
            producer: {
              name: 'producer',
              image: this.producerImage.imageUri,
              cpu: stack === 'prod' ? 512 : 256,
              memory: stack === 'prod' ? 1024 : 512,
              environment: producerServiceEnvVars,
              logConfiguration: {
                logDriver: 'awsfirelens',
                options: {
                  Name: 'datadog',
                  Host: 'http-intake.logs.us5.datadoghq.com',
                  apikey: DATADOG_API_KEY,
                  dd_service: `document-processor-producer-${stack}`,
                  dd_source: 'fargate',
                  dd_tags: 'project:cloudstorage',
                  provider: 'ecs',
                },
              },
              portMappings: [
                {
                  appProtocol: 'http',
                  name: `${BASE_NAME}-tcp-${stack}`,
                  hostPort: 8080,
                  containerPort: 8080,
                  targetGroup: this.targetGroup,
                },
              ],
            },
            consumer: {
              name: 'consumer',
              image: this.consumerImage.imageUri,
              cpu: stack === 'prod' ? 1024 : 512,
              memory: stack === 'prod' ? 4096 : 3072,
              environment: updatedConsumerServiceEnvVars,
              logConfiguration: {
                logDriver: 'awsfirelens',
                options: {
                  Name: 'datadog',
                  Host: 'http-intake.logs.us5.datadoghq.com',
                  apikey: DATADOG_API_KEY,
                  dd_service: `document-processor-consumer-${stack}`,
                  dd_source: 'fargate',
                  dd_tags: 'project:cloudstorage',
                  provider: 'ecs',
                },
              },
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
        desiredCount: stack === 'prod' ? 2 : 1,
      },
      { parent: this }
    );

    this.setupAutoScaling();
    this.setupServiceAlarms();

    const zone = aws.route53.getZoneOutput({ name: BASE_DOMAIN });

    new aws.route53.Record(`${BASE_NAME}-domain-record-${stack}`, {
      name: SERVICE_DOMAIN_NAME,
      type: 'A',
      zoneId: zone.zoneId,
      aliases: [
        {
          evaluateTargetHealth: false,
          name: this.applicationLoadBalancer.dnsName,
          zoneId: this.applicationLoadBalancer.zoneId,
        },
      ],
    });

    this.domain = `https://${SERVICE_DOMAIN_NAME}`;
  }

  setupAutoScaling() {
    if (!this.service) return;

    const serviceScalableTarget = new aws.appautoscaling.Target(
      `${BASE_NAME}-service-scalable-target-${stack}`,
      {
        maxCapacity: stack === 'prod' ? 15 : 3,
        minCapacity: stack === 'prod' ? 2 : 1,
        resourceId: pulumi.interpolate`service/${this.cloudStorageClusterName}/${this.service.service.name}`,
        scalableDimension: 'ecs:service:DesiredCount',
        serviceNamespace: 'ecs',
        tags: this.tags,
      },
      { parent: this }
    );

    const lbPortion: pulumi.Output<String> =
      this.applicationLoadBalancer.arn.apply((arn) => {
        const parts = arn.split(':loadbalancer/');
        return parts[1];
      });

    const tgPortion: pulumi.Output<String> = this.targetGroup.arn.apply(
      (arn) => {
        const parts = arn.split(':');
        return parts[parts.length - 1];
      }
    );

    const resourceLabel = pulumi.interpolate`${lbPortion}/${tgPortion}`;

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
        metricName: 'HTTPCode_ELB_5XX_Count',
        namespace: 'AWS/ApplicationELB',
        statistic: 'Sum',
        period: 180,
        evaluationPeriods: 1,
        threshold: 25,
        comparisonOperator: 'GreaterThanOrEqualToThreshold',
        dimensions: {
          LoadBalancer: this.applicationLoadBalancer.arn,
        },
        alarmDescription: `High HTTP 5XX count alarm for ${BASE_NAME} Load Balancer.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this }
    );
  }
}
