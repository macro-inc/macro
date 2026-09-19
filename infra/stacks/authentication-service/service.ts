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
  ServiceTargetGroup,
} from '../../packages/resources';
import { EcrImage } from '../../packages/service';
import {
  BASE_DOMAIN,
  CLOUD_TRAIL_SNS_TOPIC_ARN,
  DopplerEcsEnvironment,
  getGatewayAlb,
  GatewayService,
  getKafkaClusterPolicy,
  stack,
} from '../../packages/shared';

const gatewayLoadBalancer = getGatewayAlb();

const BASE_NAME = pulumi.getProject();
const REPO_ROOT = '../../..';

const MICROSOFT_TOKEN_KMS_ACTIONS = ['kms:GenerateDataKey', 'kms:Decrypt'];

// This service only ever writes a Cursor key, so it gets Encrypt and not
// Decrypt. Reading one is the agent harness's job, and granting it separately
// means a compromise of either side cannot do the other's half. `GET` on the
// settings endpoint reports whether a key exists without decrypting it, so
// nothing here needs Decrypt.
const CURSOR_API_KEY_KMS_WRITE_ACTIONS = ['kms:Encrypt'];
const CURSOR_API_KEY_KMS_READ_ACTIONS = ['kms:Decrypt'];

export const SERVICE_DOMAIN_NAME = `auth-service${
  stack === 'prod' ? '' : `-${stack}`
}.${BASE_DOMAIN}`;

type Args = {
  secretKeyArns: (pulumi.Output<string> | string)[];
  clusterName: pulumi.Output<string> | string;
  ecsClusterArn: pulumi.Output<string> | string;
  vpc: {
    vpcId: pulumi.Output<string> | string;
    publicSubnetIds: pulumi.Output<string[]> | string[];
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  platform: { family: string; architecture: 'amd64' | 'arm64' };
  serviceContainerPort: number;
  isPrivate?: boolean;
  containerEnvVars?: { name: string; value: pulumi.Output<string> | string }[];
  healthCheckPath: string;
  tags: { [key: string]: string };
  queueArns: pulumi.Output<string>[];
  microsoftTokenKmsDeletionWindowInDays: number;
  /** Deletion window for the Cursor API key CMK. */
  cursorApiKeyKmsDeletionWindowInDays: number;
  /** Role ARNs allowed to decrypt Cursor API keys — the agent harness. */
  cursorApiKeyReaderRoleArns: pulumi.Input<string>[];
};

export class AuthenticationService extends pulumi.ComponentResource {
  public role: aws.iam.Role;
  public ecr: awsx.ecr.Repository;
  public serviceAlbSg: aws.ec2.SecurityGroup;
  public serviceSg: aws.ec2.SecurityGroup;
  public targetGroup: aws.lb.TargetGroup;
  public lb: aws.lb.LoadBalancer;
  public listener: aws.lb.Listener;
  public service: awsx.ecs.FargateService;
  public domain: string;
  public clusterName: pulumi.Output<string> | string;
  public tags: { [key: string]: string };
  /** ARN of the CMK that encrypts users' Cursor API keys. The agent harness
   * needs it to grant itself Decrypt, and the service reads it as
   * `CURSOR_API_KEY_KMS_KEY_ID`. */
  public cursorApiKeyKmsKeyArn: pulumi.Output<string>;

  constructor(
    name: string,
    {
      ecsClusterArn,
      vpc,
      platform,
      serviceContainerPort,
      healthCheckPath,
      isPrivate,
      containerEnvVars,
      clusterName,
      tags,
      secretKeyArns,
      queueArns,
      microsoftTokenKmsDeletionWindowInDays,
      cursorApiKeyKmsDeletionWindowInDays,
      cursorApiKeyReaderRoleArns,
    }: Args,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:Service', name, {}, opts);
    this.tags = tags;

    this.domain = `https://${SERVICE_DOMAIN_NAME}`;
    this.clusterName = clusterName;

    // role
    const queuePolicy = new aws.iam.Policy(
      `${BASE_NAME}-sqs-policy`,
      {
        name: `${BASE_NAME}-sqs-policy-${stack}`,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: ['sqs:SendMessage'],
              Resource: queueArns,
              Effect: 'Allow',
            },
          ],
        },
        tags: this.tags,
      },
      { parent: this }
    );

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

    const sesPolicy = new aws.iam.Policy(
      `${BASE_NAME}-ses-policy`,
      {
        name: `${BASE_NAME}-ses-policy-${stack}`,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: [
                'ses:SendEmail',
                'ses:SendRawEmail',
                'ses:SendTemplatedEmail',
              ],
              Resource: [
                `arn:aws:ses:us-east-1:569036502058:identity/macro.com`,
              ],
              Effect: 'Allow',
            },
          ],
        },
        tags: this.tags,
      },
      { parent: this }
    );

    const ecsTaskAssumeRolePolicy = aws.iam.assumeRolePolicyForPrincipal({
      Service: 'ecs-tasks.amazonaws.com',
    });

    this.role = new aws.iam.Role(
      `${BASE_NAME}-role`,
      {
        name: `${BASE_NAME}-role-${stack}`,
        assumeRolePolicy: ecsTaskAssumeRolePolicy,
        tags: this.tags,
        managedPolicyArns: [
          secretsPolicy.arn,
          sesPolicy.arn,
          queuePolicy.arn,
          getKafkaClusterPolicy(),
        ],
      },
      { parent: this }
    );

    const accountRootArn = pulumi.interpolate`arn:aws:iam::${aws.getCallerIdentityOutput().accountId}:root`;
    const microsoftTokenKmsKeyPolicy = aws.iam.getPolicyDocumentOutput({
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
          sid: 'AllowAuthenticationServiceTokenEncryption',
          effect: 'Allow',
          principals: [{ type: 'AWS', identifiers: [this.role.arn] }],
          actions: MICROSOFT_TOKEN_KMS_ACTIONS,
          resources: ['*'],
        },
      ],
    });

    const microsoftTokenKmsKey = new aws.kms.Key(
      `${BASE_NAME}-microsoft-token-key`,
      {
        description: `Microsoft refresh-token envelope key for ${stack}`,
        deletionWindowInDays: microsoftTokenKmsDeletionWindowInDays,
        enableKeyRotation: true,
        policy: microsoftTokenKmsKeyPolicy.json,
        tags: this.tags,
      },
      { parent: this, protect: stack === 'prod' }
    );

    new aws.kms.Alias(
      `${BASE_NAME}-microsoft-token-key-alias`,
      {
        name: `alias/${BASE_NAME}-microsoft-token-${stack}`,
        targetKeyId: microsoftTokenKmsKey.keyId,
      },
      { parent: this }
    );

    new aws.iam.RolePolicy(
      `${BASE_NAME}-microsoft-token-kms-policy`,
      {
        role: this.role.id,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: MICROSOFT_TOKEN_KMS_ACTIONS,
              Resource: microsoftTokenKmsKey.arn,
              Effect: 'Allow',
            },
          ],
        },
      },
      { parent: this }
    );

    // A key of its own rather than the Microsoft one. The argument is IAM, not
    // rotation: sharing it would grant the agent harness — which runs agent
    // code — decrypt permission on the key protecting everyone's mailbox
    // refresh tokens. Different blast radii should not share a key.
    const cursorApiKeyKmsKeyPolicy = aws.iam.getPolicyDocumentOutput({
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
          sid: 'AllowAuthenticationServiceCursorKeyEncryption',
          effect: 'Allow',
          principals: [{ type: 'AWS', identifiers: [this.role.arn] }],
          actions: CURSOR_API_KEY_KMS_WRITE_ACTIONS,
          resources: ['*'],
        },
        // The agent harness decrypts a session owner's key at every spawn and
        // resume. Granted by role ARN passed in rather than by this stack
        // reaching into another, so the dependency stays one-directional.
        {
          sid: 'AllowAgentHarnessCursorKeyDecryption',
          effect: 'Allow',
          principals: [
            { type: 'AWS', identifiers: cursorApiKeyReaderRoleArns },
          ],
          actions: CURSOR_API_KEY_KMS_READ_ACTIONS,
          resources: ['*'],
        },
      ],
    });

    const cursorApiKeyKmsKey = new aws.kms.Key(
      `${BASE_NAME}-cursor-api-key-key`,
      {
        description: `Cursor API key encryption key for ${stack}`,
        deletionWindowInDays: cursorApiKeyKmsDeletionWindowInDays,
        enableKeyRotation: true,
        policy: cursorApiKeyKmsKeyPolicy.json,
        tags: this.tags,
      },
      { parent: this, protect: stack === 'prod' }
    );

    new aws.kms.Alias(
      `${BASE_NAME}-cursor-api-key-key-alias`,
      {
        name: `alias/${BASE_NAME}-cursor-api-key-${stack}`,
        targetKeyId: cursorApiKeyKmsKey.keyId,
      },
      { parent: this }
    );

    new aws.iam.RolePolicy(
      `${BASE_NAME}-cursor-api-key-kms-policy`,
      {
        role: this.role.id,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: CURSOR_API_KEY_KMS_WRITE_ACTIONS,
              Resource: cursorApiKeyKmsKey.arn,
              Effect: 'Allow',
            },
          ],
        },
      },
      { parent: this }
    );

    // The ARN the harness stack needs in order to grant itself Decrypt, and
    // what the service reads as CURSOR_API_KEY_KMS_KEY_ID.
    this.cursorApiKeyKmsKeyArn = cursorApiKeyKmsKey.arn;

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
          SERVICE_NAME: 'authentication_service',
        },
      },
      { parent: this }
    );
    this.ecr = image.ecr;

    // sg
    const sg = this.initializeSecurityGroups({
      vpcId: vpc.vpcId,
      serviceContainerPort,
    });
    this.serviceAlbSg = sg.serviceAlbSg;
    this.serviceSg = sg.serviceSg;

    const gatewayTargetGroup = new ServiceTargetGroup(
      `${stack}-${BASE_NAME}`,
      {
        tags: this.tags,
        listenerArn: gatewayLoadBalancer.httpsListenerArn,
        vpcId: vpc.vpcId,
        containerPort: serviceContainerPort,
        service: GatewayService.AUTHENTICATION_SERVICE,
        healthCheckPath,
        pathPatterns: ['/auth', '/auth/*'],
        serviceSecurityGroupId: this.serviceSg.id,
        albSecurityGroupId: gatewayLoadBalancer.albSecurityGroupId,
      },
      { parent: this }
    );

    // lb
    const { targetGroup, lb, listener } = serviceLoadBalancer(this, {
      serviceName: BASE_NAME, // service name
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
        // Register tasks in both the legacy ALB's target group and the gateway
        // target group while we migrate to the gateway. An explicit
        // `loadBalancers` replaces the list awsx derives from
        // `portMappings.targetGroup`, so the legacy entry must be listed here
        // too.
        loadBalancers: [
          {
            targetGroupArn: targetGroup.arn,
            containerName: 'service',
            containerPort: serviceContainerPort,
          },
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
              cpu: 512,
              memory: 718, //1024 - (256 + 50)
              environment: [
                { name: 'BASE_URL', value: this.domain },
                // Injected here rather than configured in Doppler: a key id is
                // not a secret, and deriving it from the resource keeps the two
                // from drifting. Note MICROSOFT_TOKEN_KMS_KEY_ID is documented
                // as injected the same way but is not — see the Pulumi yaml
                // comment; that gap is not fixed here.
                {
                  name: 'CURSOR_API_KEY_KMS_KEY_ID',
                  value: cursorApiKeyKmsKey.arn,
                },
                ...(containerEnvVars ?? []),
              ],
              secrets: [...dopplerEcsEnvironment.containerSecrets],
              logConfiguration: {
                logDriver: 'awsfirelens',
                options: {
                  Name: 'datadog',
                  Host: 'http-intake.logs.us5.datadoghq.com',
                  apikey: DATADOG_API_KEY,
                  dd_service: 'authentication-service',
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

    // domain record
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

  initializeSecurityGroups({
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
        description: `${BASE_NAME} security group that is attached directly to the service`,
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupIngressRule(
      `${BASE_NAME}-alb-in`,
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

    // ALB SG rules
    new aws.vpc.SecurityGroupIngressRule(
      `${BASE_NAME}-http`,
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
      `${BASE_NAME}-https`,
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
      `${BASE_NAME}-out-service`,
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
        maxCapacity: stack === 'prod' ? 10 : 3,
        minCapacity: 1,
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
        alarmDescription: `High HTTP 5XX count alarm for ${BASE_NAME} Load Balancer.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this }
    );
  }
}
