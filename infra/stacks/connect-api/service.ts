import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import { Secret, type Provider } from '@pulumiverse/doppler';
import {
  DATADOG_API_KEY,
  DEFAULT_CONTINUE_BEFORE_STEADY_STATE,
  EcsDeploymentFailureAlarm,
  withTelemetry,
  ServiceTargetGroup,
} from '../../packages/resources';
import { EcrImage } from '../../packages/service';
import {
  BASE_DOMAIN,
  CLOUD_TRAIL_SNS_TOPIC_ARN,
  DopplerEcsEnvironment,
  getGatewayAlb,
  GatewayService,
  stack,
} from '../../packages/shared';

const gatewayLoadBalancer = getGatewayAlb();

const BASE_NAME = pulumi.getProject();
const REPO_ROOT = '../../..';

type CreateConnectApiServiceArgs = {
  doppler: Provider;
  vpc: {
    vpcId: pulumi.Output<string> | string;
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  tags: { [key: string]: string };
  platform: { family: string; architecture: 'amd64' | 'arm64' };
  serviceContainerPort: number;
  healthCheckPath: string;
  ecsClusterArn: pulumi.Output<string> | string;
  cloudStorageClusterName: pulumi.Output<string> | string;
};

export class ConnectApiService extends pulumi.ComponentResource {
  public role: aws.iam.Role;
  public kmsKey: aws.kms.Key;
  public database: aws.rds.Instance;
  public ecr: awsx.ecr.Repository;
  public serviceSg: aws.ec2.SecurityGroup;
  public domain: string;
  public tags: { [key: string]: string };
  public targetGroup: aws.lb.TargetGroup;
  public service: awsx.ecs.FargateService;
  public cloudStorageClusterName: pulumi.Output<string> | string;

  constructor(
    name: string,
    {
      vpc,
      tags,
      doppler,
      platform,
      serviceContainerPort,
      healthCheckPath,
      ecsClusterArn,
      cloudStorageClusterName,
    }: CreateConnectApiServiceArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:ConnectApiService', name, {}, opts);
    this.domain = `https://${
      stack === 'prod' ? '' : `${stack}-`
    }gateway.${BASE_DOMAIN}/connect`;
    this.tags = tags;
    this.cloudStorageClusterName = cloudStorageClusterName;

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
        tags: this.tags,
      },
      { parent: this }
    );

    const account = aws.getCallerIdentityOutput({});
    this.kmsKey = new aws.kms.Key(
      `${BASE_NAME}-grants-${stack}`,
      {
        description: 'Macro Connect grant envelope key',
        enableKeyRotation: true,
        deletionWindowInDays: 30,
        tags: this.tags,
        policy: pulumi.jsonStringify({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'KeyAdministration',
              Effect: 'Allow',
              Principal: {
                AWS: pulumi.interpolate`arn:aws:iam::${account.accountId}:root`,
              },
              Action: [
                'kms:Create*',
                'kms:Describe*',
                'kms:Enable*',
                'kms:List*',
                'kms:Put*',
                'kms:Update*',
                'kms:Revoke*',
                'kms:Disable*',
                'kms:Get*',
                'kms:Delete*',
                'kms:TagResource',
                'kms:UntagResource',
                'kms:ScheduleKeyDeletion',
                'kms:CancelKeyDeletion',
              ],
              Resource: '*',
            },
            {
              Sid: 'ConnectTaskCryptography',
              Effect: 'Allow',
              Principal: { AWS: this.role.arn },
              Action: ['kms:Encrypt', 'kms:Decrypt', 'kms:GenerateDataKey'],
              Resource: '*',
            },
          ],
        }),
      },
      { parent: this, protect: true }
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
        platform,
        buildArgs: {
          SERVICE_NAME: 'connect_api',
        },
        tags: this.tags,
      },
      { parent: this }
    );
    this.ecr = image.ecr;

    // Security groups
    this.serviceSg = this.initializeSecurityGroups({ vpcId: vpc.vpcId });

    const databaseSg = new aws.ec2.SecurityGroup(
      `${BASE_NAME}-db-sg-${stack}`,
      { vpcId: vpc.vpcId, tags: this.tags },
      { parent: this }
    );
    new aws.vpc.SecurityGroupIngressRule(
      `${BASE_NAME}-db-in-${stack}`,
      {
        securityGroupId: databaseSg.id,
        referencedSecurityGroupId: this.serviceSg.id,
        fromPort: 5432,
        toPort: 5432,
        ipProtocol: 'tcp',
        tags: this.tags,
      },
      { parent: this }
    );
    const databaseSubnets = new aws.rds.SubnetGroup(
      `${BASE_NAME}-db-subnets-${stack}`,
      { subnetIds: vpc.privateSubnetIds, tags: this.tags },
      { parent: this }
    );
    this.database = new aws.rds.Instance(
      `${BASE_NAME}-db-${stack}`,
      {
        identifier: `${BASE_NAME}-db-${stack}`,
        engine: 'postgres',
        engineVersion: '17',
        instanceClass: stack === 'prod' ? 'db.t4g.small' : 'db.t4g.micro',
        allocatedStorage: 20,
        storageType: 'gp3',
        storageEncrypted: true,
        dbName: 'connect',
        username: 'connect_api',
        manageMasterUserPassword: true,
        dbSubnetGroupName: databaseSubnets.name,
        vpcSecurityGroupIds: [databaseSg.id],
        publiclyAccessible: false,
        backupRetentionPeriod: stack === 'prod' ? 14 : 7,
        deletionProtection: stack === 'prod',
        skipFinalSnapshot: stack !== 'prod',
        finalSnapshotIdentifier:
          stack === 'prod' ? `${BASE_NAME}-db-${stack}-final` : undefined,
        tags: this.tags,
      },
      { parent: this, protect: stack === 'prod' }
    );
    const masterSecretArn = this.database.masterUserSecrets.apply((secrets) => {
      if (secrets.length !== 1)
        throw new Error('missing RDS master user secret');
      return secrets[0].secretArn;
    });
    const masterSecret = aws.secretsmanager.getSecretVersionOutput({
      secretId: masterSecretArn,
    });
    const databaseUrl = pulumi.secret(
      pulumi
        .all([this.database.address, masterSecret.secretString])
        .apply(([address, secret]) => {
          const credentials = JSON.parse(secret) as { password: string };
          return `postgresql://connect_api:${encodeURIComponent(credentials.password)}@${address}:5432/connect`;
        })
    );
    const runtimeConfig = {
      DATABASE_URL: databaseUrl,
      CONNECT_KMS_KEY_ID: this.kmsKey.keyId,
      CONNECT_PUBLIC_URL: this.domain,
    };
    const configSecrets = Object.entries(runtimeConfig).map(
      ([key, value]) =>
        new Secret(
          `${BASE_NAME}-${key}-${stack}`,
          {
            project: BASE_NAME,
            config: stack === 'prod' ? 'prd' : 'dev',
            name: key,
            value,
          },
          { parent: this, provider: doppler }
        )
    );

    const gatewayTargetGroup = new ServiceTargetGroup(
      `${stack}-${BASE_NAME}`,
      {
        tags: this.tags,
        listenerArn: gatewayLoadBalancer.httpsListenerArn,
        vpcId: vpc.vpcId,
        containerPort: serviceContainerPort,
        service: GatewayService.CONNECT_API,
        healthCheckPath,
        // connect-api owns `/connect` on the shared gateway listener
        // (GatewayService.CONNECT_API, priority 170) — see
        // infra/packages/shared/src/gateway_priorities.ts.
        pathPatterns: ['/connect', '/connect/*'],
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

    // Fargate Service
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
          containers: withTelemetry(BASE_NAME, {
            service: {
              name: 'service',
              image: image.image.imageUri,
              stopTimeout: 10, // 10 seconds to force kill the task
              cpu: stack === 'prod' ? 512 : 256,
              memory: stack === 'prod' ? 1024 : 512,
              environment: [
                { name: 'ENVIRONMENT', value: stack },
                { name: 'DD_SERVICE', value: 'connect-api' },
                { name: 'DD_ENV', value: stack },
                {
                  name: 'RUST_BACKTRACE',
                  value: '1',
                },
              ],
              secrets: [...dopplerEcsEnvironment.containerSecrets],
              logConfiguration: {
                logDriver: 'awsfirelens',
                options: {
                  Name: 'datadog',
                  Host: 'http-intake.logs.us5.datadoghq.com',
                  apikey: DATADOG_API_KEY,
                  dd_service: 'connect-api',
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
          }),
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
        dependsOn: [gatewayTargetGroup.listener_rule, ...configSecrets],
      }
    );
    this.service = service;

    // auto-scaling and alarm notifications
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
        maxCapacity: stack === 'prod' ? 3 : 2,
        minCapacity: 1,
        resourceId: pulumi.interpolate`service/${this.cloudStorageClusterName}/${this.service.service.name}`,
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
