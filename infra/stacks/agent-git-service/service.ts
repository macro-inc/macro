import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import {
  DATADOG_API_KEY,
  DEFAULT_CONTINUE_BEFORE_STEADY_STATE,
  EcsDeploymentFailureAlarm,
  ServiceTargetGroup,
  withTelemetry,
} from '../../packages/resources';
import { EcrImage } from '../../packages/service';
import {
  BASE_DOMAIN,
  CLOUD_TRAIL_SNS_TOPIC_ARN,
  DopplerEcsEnvironment,
  GatewayService,
  getGatewayAlb,
  stack,
} from '../../packages/shared';

const gatewayLoadBalancer = getGatewayAlb();

const BASE_NAME = pulumi.getProject();
const REPO_ROOT = '../../..';

/** Where the service reads `REPO_STORAGE_ROOT`; set to this path in Doppler. */
const REPO_STORAGE_PATH = '/data/agent-git';
const REPO_VOLUME_NAME = 'agent-git-repos';

type CreateAgentGitServiceArgs = {
  vpc: {
    vpcId: string;
    privateSubnetIds: string[];
  };
  tags: { [key: string]: string };
  containerEnvVars: { name: string; value: pulumi.Output<string> | string }[];
  platform: { family: string; architecture: 'amd64' | 'arm64' };
  serviceContainerPort: number;
  healthCheckPath: string;
  ecsClusterArn: pulumi.Output<string> | string;
  cloudStorageClusterName: pulumi.Output<string> | string;
  secretKeyArns: (pulumi.Output<string> | string)[];
};

export class AgentGitService extends pulumi.ComponentResource {
  public role: aws.iam.Role;
  public ecr: awsx.ecr.Repository;
  public serviceSg: aws.ec2.SecurityGroup;
  public fileSystem: aws.efs.FileSystem;
  public accessPoint: aws.efs.AccessPoint;
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
      platform,
      serviceContainerPort,
      healthCheckPath,
      ecsClusterArn,
      containerEnvVars,
      cloudStorageClusterName,
      secretKeyArns,
    }: CreateAgentGitServiceArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:AgentGitService', name, {}, opts);
    this.domain = `https://${
      stack === 'prod' ? '' : `${stack}-`
    }gateway.${BASE_DOMAIN}/agent-git`;
    this.tags = tags;
    this.cloudStorageClusterName = cloudStorageClusterName;

    this.serviceSg = this.initializeSecurityGroups({ vpcId: vpc.vpcId });

    const { fileSystem, accessPoint, mountTargets } =
      this.initializeRepoStorage({
        vpcId: vpc.vpcId,
        privateSubnetIds: vpc.privateSubnetIds,
      });
    this.fileSystem = fileSystem;
    this.accessPoint = accessPoint;

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
              Resource: [...secretKeyArns],
              Effect: 'Allow',
            },
          ],
        },
        tags: this.tags,
      },
      { parent: this }
    );

    const efsPolicy = new aws.iam.Policy(
      `${BASE_NAME}-efs-policy`,
      {
        name: `${BASE_NAME}-efs-policy-${stack}`,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: [
                'elasticfilesystem:ClientMount',
                'elasticfilesystem:ClientWrite',
              ],
              Resource: [fileSystem.arn],
              Effect: 'Allow',
              Condition: {
                StringEquals: {
                  'elasticfilesystem:AccessPointArn': accessPoint.arn,
                },
              },
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
          ],
        },
        tags: this.tags,
        managedPolicyArns: [secretsManagerPolicy.arn, efsPolicy.arn],
      },
      { parent: this }
    );

    // Only the task role may mount, only through the access point, and only
    // over TLS.
    new aws.efs.FileSystemPolicy(
      `${BASE_NAME}-efs-file-system-policy`,
      {
        fileSystemId: fileSystem.id,
        policy: pulumi.jsonStringify({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'AllowTaskRoleThroughAccessPoint',
              Effect: 'Allow',
              Principal: { AWS: this.role.arn },
              Action: [
                'elasticfilesystem:ClientMount',
                'elasticfilesystem:ClientWrite',
              ],
              Resource: fileSystem.arn,
              Condition: {
                StringEquals: {
                  'elasticfilesystem:AccessPointArn': accessPoint.arn,
                },
              },
            },
            {
              Sid: 'DenyInsecureTransport',
              Effect: 'Deny',
              Principal: { AWS: '*' },
              Action: '*',
              Resource: fileSystem.arn,
              Condition: { Bool: { 'aws:SecureTransport': 'false' } },
            },
          ],
        }),
      },
      { parent: this }
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
          // The Dockerfiles install `git` (for `git http-backend`) only for
          // this service name.
          SERVICE_NAME: 'agent_git_service',
        },
        tags: this.tags,
      },
      { parent: this }
    );
    this.ecr = image.ecr;

    const gatewayTargetGroup = new ServiceTargetGroup(
      `${stack}-${BASE_NAME}`,
      {
        tags: this.tags,
        listenerArn: gatewayLoadBalancer.httpsListenerArn,
        vpcId: vpc.vpcId,
        containerPort: serviceContainerPort,
        service: GatewayService.AGENT_GIT_SERVICE,
        healthCheckPath,
        // agent-git-service owns `/agent-git` on the shared gateway listener
        // (GatewayService.AGENT_GIT_SERVICE) — see
        // infra/packages/shared/src/gateway_priorities.ts.
        pathPatterns: ['/agent-git', '/agent-git/*'],
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

    const service = new awsx.ecs.FargateService(
      `${BASE_NAME}`,
      {
        tags,
        cluster: ecsClusterArn,
        // EFS volumes need Fargate platform 1.4.0 or later.
        platformVersion: 'LATEST',
        networkConfiguration: {
          subnets: vpc.privateSubnetIds,
          securityGroups: [this.serviceSg.id],
        },
        continueBeforeSteadyState: DEFAULT_CONTINUE_BEFORE_STEADY_STATE,
        deploymentCircuitBreaker: {
          enable: true,
          rollback: true,
        },
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
          volumes: [
            {
              name: REPO_VOLUME_NAME,
              efsVolumeConfiguration: {
                fileSystemId: fileSystem.id,
                transitEncryption: 'ENABLED',
                authorizationConfig: {
                  accessPointId: accessPoint.id,
                  iam: 'ENABLED',
                },
              },
            },
          ],
          containers: withTelemetry(BASE_NAME, {
            service: {
              name: 'service',
              image: image.image.imageUri,
              stopTimeout: 10,
              cpu: stack === 'prod' ? 1024 : 512,
              memory: stack === 'prod' ? 2048 : 1024,
              environment: [
                ...containerEnvVars,
                {
                  name: 'BASE_URL',
                  value: this.domain,
                },
                {
                  name: 'RUST_BACKTRACE',
                  value: '1',
                },
              ],
              secrets: [...dopplerEcsEnvironment.containerSecrets],
              mountPoints: [
                {
                  sourceVolume: REPO_VOLUME_NAME,
                  containerPath: REPO_STORAGE_PATH,
                  readOnly: false,
                },
              ],
              logConfiguration: {
                logDriver: 'awsfirelens',
                options: {
                  Name: 'datadog',
                  Host: 'http-intake.logs.us5.datadoghq.com',
                  apikey: DATADOG_API_KEY,
                  dd_service: 'agent-git-service',
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
        // One fixed task, no autoscaling: the per-repository push rate limit
        // (PUSHES_PER_MINUTE) is held in memory, so a second task would double
        // it. Scale out only after that state moves out of the process.
        desiredCount: 1,
      },
      {
        parent: this,
        // ECS refuses a service whose target group is not yet associated with
        // a load balancer; the listener rule creates that association. Tasks
        // also fail to start until a mount target exists in their subnet.
        dependsOn: [gatewayTargetGroup.listener_rule, ...mountTargets],
      }
    );
    this.service = service;

    this.setupServiceAlarms();
  }

  initializeSecurityGroups({ vpcId }: { vpcId: string }) {
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

  /**
   * Encrypted EFS for the bare repositories, reachable on NFS only from the
   * service security group.
   *
   * The access point maps every client to root (uid/gid 0), the user the
   * container already runs as, so the repositories' owner matches the process
   * and git's `safe.directory` ownership check passes without configuration.
   */
  initializeRepoStorage({
    vpcId,
    privateSubnetIds,
  }: {
    vpcId: string;
    privateSubnetIds: string[];
  }) {
    const fileSystem = new aws.efs.FileSystem(
      `${BASE_NAME}-repos`,
      {
        encrypted: true,
        performanceMode: 'generalPurpose',
        throughputMode: 'elastic',
        tags: { ...this.tags, Name: `${BASE_NAME}-repos-${stack}` },
      },
      // The repositories are user data: never delete them with the stack.
      { parent: this, retainOnDelete: true }
    );

    const efsSg = new aws.ec2.SecurityGroup(
      `${BASE_NAME}-efs-sg-${stack}`,
      {
        name: `${BASE_NAME}-efs-sg-${stack}`,
        vpcId,
        description: `${BASE_NAME} repository EFS mount targets`,
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupIngressRule(
      `${BASE_NAME}-efs-nfs-in`,
      {
        securityGroupId: efsSg.id,
        description: 'NFS from the agent-git-service tasks',
        referencedSecurityGroupId: this.serviceSg.id,
        ipProtocol: 'tcp',
        fromPort: 2049,
        toPort: 2049,
        tags: this.tags,
      },
      { parent: this }
    );

    const mountTargets = privateSubnetIds.map(
      (subnetId, index) =>
        new aws.efs.MountTarget(
          `${BASE_NAME}-efs-mount-${index}`,
          {
            fileSystemId: fileSystem.id,
            subnetId,
            securityGroups: [efsSg.id],
          },
          { parent: this }
        )
    );

    const accessPoint = new aws.efs.AccessPoint(
      `${BASE_NAME}-repos-access-point`,
      {
        fileSystemId: fileSystem.id,
        posixUser: { uid: 0, gid: 0 },
        rootDirectory: {
          path: '/agent-git',
          creationInfo: {
            ownerUid: 0,
            ownerGid: 0,
            permissions: '0755',
          },
        },
        tags: this.tags,
      },
      { parent: this }
    );

    return { fileSystem, accessPoint, mountTargets };
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
