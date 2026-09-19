import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import {
  attachFrecencyTablePolicy,
  createFrecencyTablePolicy,
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
  getKafkaClusterPolicy,
  stack,
  getGatewayAlb,
  GatewayService,
} from '../../packages/shared';

const gatewayLoadBalancer = getGatewayAlb();

const BASE_NAME = pulumi.getProject();
const REPO_ROOT = '../../..';

type CreateCloudStorageServiceServiceArgs = {
  cloudStorageClusterName: pulumi.Output<string> | string;
  ecsClusterArn: pulumi.Output<string> | string;
  vpc: {
    vpcId: pulumi.Output<string> | string;
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  platform: { family: string; architecture: 'amd64' | 'arm64' };
  documentStorageBucketArn: pulumi.Output<string> | string;
  docxUploadBucketArn: pulumi.Output<string> | string;
  serviceContainerPort: number;
  containerEnvVars?: { name: string; value: pulumi.Output<string> | string }[];
  healthCheckPath: string;
  secretKeyArns: (pulumi.Output<string> | string)[];
  queueArns: (pulumi.Output<string> | string)[];
  callRecordingCrudPolicyArn: pulumi.Output<string> | string;
  snsPlatformArns: (pulumi.Output<string> | string)[];
  tags: { [key: string]: string };
};

export class CloudStorageService extends pulumi.ComponentResource {
  public role: aws.iam.Role;
  public ecr: awsx.ecr.Repository;
  public serviceSg: aws.ec2.SecurityGroup;
  public targetGroup: aws.lb.TargetGroup;
  public service: awsx.ecs.FargateService;
  public cloudStorageClusterName: pulumi.Output<string> | string;
  public tags: { [key: string]: string };

  constructor(
    name: string,
    {
      ecsClusterArn,
      vpc,
      platform,
      documentStorageBucketArn,
      docxUploadBucketArn,
      serviceContainerPort,
      healthCheckPath,
      containerEnvVars,
      cloudStorageClusterName,
      secretKeyArns,
      queueArns,
      callRecordingCrudPolicyArn,
      snsPlatformArns,
      tags,
    }: CreateCloudStorageServiceServiceArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:CloudStorageService', name, {}, opts);
    this.tags = tags;

    this.cloudStorageClusterName = cloudStorageClusterName;

    // role
    const frecencyTablePolicy = createFrecencyTablePolicy(
      `${BASE_NAME}-frecency-table-policy`,
      { parent: this }
    );

    const docStorageBucketPolicy = new aws.iam.Policy(
      `${BASE_NAME}-doc-storage-policy`,
      {
        name: `${BASE_NAME}-doc-storage-bucket-policy-${stack}`,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: [
                's3:ListBucket',
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
              ],
              Resource: [
                documentStorageBucketArn,
                pulumi.interpolate`${documentStorageBucketArn}/*`,
                docxUploadBucketArn,
                pulumi.interpolate`${docxUploadBucketArn}/*`,
              ],
              Effect: 'Allow',
            },
          ],
        },
        tags: this.tags,
      },
      { parent: this }
    );

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
        tags: this.tags,
      },
      { parent: this }
    );

    const queuePolicy = new aws.iam.Policy(
      `${BASE_NAME}-queue-policy`,
      {
        name: `${BASE_NAME}-queue-policy-${stack}`,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: ['sqs:*'],
              Resource: queueArns,
              Effect: 'Allow',
            },
          ],
        },
        tags: this.tags,
      },
      { parent: this }
    );

    const snsPolicy = new aws.iam.Policy(
      `${BASE_NAME}-sns-policy`,
      {
        name: `${BASE_NAME}-sns-policy-${stack}`,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: [
                'sns:CreatePlatformEndpoint',
                'sns:DeleteEndpoint',
                'sns:GetEndpointAttributes',
                'sns:SetEndpointAttributes',
                'sns:Publish',
              ],
              Resource: snsPlatformArns,
              Effect: 'Allow',
            },
          ],
        },
        tags: this.tags,
      },
      { parent: this }
    );

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
            {
              Sid: 'AllowAccountAssumeRole',
              Effect: 'Allow',
              Principal: {
                AWS: 'arn:aws:iam::569036502058:root',
              },
              Action: 'sts:AssumeRole',
            },
          ],
        },
        tags: { ...this.tags, 'call-recording-access': 'true' },
      },
      { parent: this }
    );

    attachFrecencyTablePolicy(
      `${BASE_NAME}-role-frecency-table-att`,
      this.role,
      frecencyTablePolicy,
      { parent: this }
    );

    new aws.iam.RolePolicyAttachment(
      `${BASE_NAME}-role-doc-storage-att`,
      {
        role: this.role,
        policyArn: docStorageBucketPolicy.arn,
      },
      { parent: this, dependsOn: [docStorageBucketPolicy, this.role] }
    );

    new aws.iam.RolePolicyAttachment(
      `${BASE_NAME}-role-secrets-manager-att-${stack}`,
      {
        role: this.role,
        policyArn: secretsManagerPolicy.arn,
      },
      { parent: this, dependsOn: [secretsManagerPolicy, this.role] }
    );

    new aws.iam.RolePolicyAttachment(
      `${BASE_NAME}-role-queue-att-${stack}`,
      {
        role: this.role,
        policyArn: queuePolicy.arn,
      },
      { parent: this, dependsOn: [queuePolicy, this.role] }
    );

    new aws.iam.RolePolicyAttachment(
      `${BASE_NAME}-role-call-recording-att-${stack}`,
      {
        role: this.role,
        policyArn: pulumi.interpolate`${callRecordingCrudPolicyArn}`,
      }
    );

    new aws.iam.RolePolicyAttachment(
      `${BASE_NAME}-role-sns-att-${stack}`,
      {
        role: this.role,
        policyArn: snsPolicy.arn,
      },
      { parent: this, dependsOn: [snsPolicy, this.role] }
    );

    // Producer/consumer access to the macro event Kafka cluster.
    new aws.iam.RolePolicyAttachment(
      `${BASE_NAME}-role-kafka-client-att-${stack}`,
      {
        role: this.role,
        policyArn: getKafkaClusterPolicy(),
      },
      { parent: this, dependsOn: [this.role] }
    );

    // ecr image
    const image = new EcrImage(
      `${BASE_NAME}-ecr-image-${stack}`,
      {
        repositoryId: `${BASE_NAME}-ecr-${stack}`,
        repositoryName: `${BASE_NAME}-${stack}`,
        imageId: `${BASE_NAME}-image-${stack}`,
        imagePath: REPO_ROOT,
        dockerfile: 'docker/Dockerfile',
        buildArgs: {
          SERVICE_NAME: 'document_storage_service',
        },
        platform,
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
        service: GatewayService.DOCUMENT_STORAGE_SERVICE,
        healthCheckPath,
        pathPatterns: ['/dss', '/dss/*'],
        serviceSecurityGroupId: this.serviceSg.id,
        albSecurityGroupId: gatewayLoadBalancer.albSecurityGroupId,
      },
      { parent: this }
    );

    this.targetGroup = gatewayTargetGroup.target_group;

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
              stopTimeout: 10, // 10 seconds to force kill the task
              cpu: stack === 'prod' ? 2048 : 512,
              memory: stack === 'prod' ? 4096 : 2048,
              environment: containerEnvVars,
              secrets: [...dopplerEcsEnvironment.containerSecrets],
              logConfiguration: {
                logDriver: 'awsfirelens',
                options: {
                  Name: 'datadog',
                  Host: 'http-intake.logs.us5.datadoghq.com',
                  apikey: DATADOG_API_KEY,
                  dd_service: `cloud-storage-service`,
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

    this.setupAutoScaling();

    this.setupServiceAlarms();
  }

  initializeSecurityGroups({
    vpcId,
  }: {
    vpcId: pulumi.Output<string> | string;
  }) {
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

  setupAutoScaling() {
    if (!this.service) return;

    const serviceScalableTarget = new aws.appautoscaling.Target(
      `${BASE_NAME}-service-scalable-target-${stack}`,
      {
        maxCapacity: stack === 'prod' ? 7 : 3,
        minCapacity: stack === 'prod' ? 3 : 1,
        resourceId: pulumi.interpolate`service/${this.cloudStorageClusterName}/${this.service.service.name}`,
        scalableDimension: 'ecs:service:DesiredCount',
        serviceNamespace: 'ecs',
        tags: this.tags,
      },
      { parent: this }
    );

    const resourceLabel = pulumi.interpolate`${gatewayLoadBalancer.albArnSuffix}/${this.targetGroup.arnSuffix}`;

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
        name: `${stack}-${BASE_NAME}-http-5xx`,
        // Target-generated errors can be scoped to this service on the shared ALB.
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
