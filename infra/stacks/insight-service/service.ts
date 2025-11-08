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
import { BASE_DOMAIN, stack } from '@shared';

const BASE_NAME = 'insight-service';

export const USER_INSIGHT_DOMAIN_NAME = `insight-service${
  stack === 'prod' ? '' : `-${stack}`
}.${BASE_DOMAIN}`;

type InsightServiceArgs = {
  ecsClusterArn: pulumi.Input<string>;
  vpc: {
    vpcId: pulumi.Output<string> | string;
    publicSubnetIds: pulumi.Output<string[]> | string[];
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  platform: { family: string; architecture: 'amd64' | 'arm64' };
  queueArn: pulumi.Input<string>;
  envVars: { name: string; value: pulumi.Input<string> }[];
  tags: Record<string, string>;
  secretKeyArns: pulumi.Output<string>[] | string[];
  port: number;
};

export class InsightService extends pulumi.ComponentResource {
  public role: aws.iam.Role;
  public service: awsx.ecs.FargateService;
  public domain: string;
  public lb: aws.lb.LoadBalancer;
  public listener: aws.lb.Listener;
  public targetGroup: aws.lb.TargetGroup;

  constructor(
    name: string,
    {
      ecsClusterArn,
      vpc,
      platform,
      queueArn,
      envVars,
      tags,
      secretKeyArns,
      port,
    }: InsightServiceArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:UserInsightService', name, {}, opts);

    const image = new EcrImage(
      `${BASE_NAME}-image-${stack}`,
      {
        repositoryId: `${BASE_NAME}-ecr-${stack}`,
        repositoryName: `${BASE_NAME}-${stack}`,
        imageId: `${BASE_NAME}-image-${stack}`,
        imagePath: '../../../',
        dockerfile: 'Dockerfile',
        platform,
        buildArgs: {
          SERVICE_NAME: 'insight_service',
        },
        tags,
      },
      { parent: this }
    );

    const serviceSg = new aws.ec2.SecurityGroup(
      `${BASE_NAME}-sg-${stack}`,
      {
        name: `${BASE_NAME}-sg-${stack}`,
        vpcId: vpc.vpcId,
        description: `${BASE_NAME} service security group`,
        tags,
      },
      { parent: this }
    );

    const queuePolicy = new aws.iam.Policy(
      `${BASE_NAME}-sqs-policy-${stack}`,
      {
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: [
                'sqs:ReceiveMessage',
                'sqs:DeleteMessage',
                'sqs:GetQueueAttributes',
              ],
              Resource: [queueArn],
              Effect: 'Allow',
            },
          ],
        },
        tags,
      },
      { parent: this }
    );

    const serviceAlbSg = new aws.ec2.SecurityGroup(
      `${BASE_NAME}-alb-sg-${stack}`,
      {
        name: `${BASE_NAME}-alb-sg-${stack}`,
        description: `${BASE_NAME} application load balancer security group`,
        vpcId: vpc.vpcId,
        tags: tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupEgressRule(
      `${BASE_NAME}-out-service`,
      {
        description: 'Allow traffic to the service security group',
        securityGroupId: serviceAlbSg.id,
        referencedSecurityGroupId: serviceSg.id,
        fromPort: port,
        ipProtocol: 'tcp',
        toPort: port,
        tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupIngressRule(
      `${BASE_NAME}-alb-in`,
      {
        securityGroupId: serviceSg.id,
        description: 'Allow inbound traffic from the services ALB',
        referencedSecurityGroupId: serviceAlbSg.id,
        fromPort: port,
        toPort: port,
        ipProtocol: 'tcp',
        tags: tags,
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
        tags: tags,
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
        tags: tags,
      },
      { parent: this }
    );

    const { targetGroup, lb, listener } = serviceLoadBalancer(this, {
      serviceName: BASE_NAME,
      serviceContainerPort: port,
      healthCheckPath: '/health',
      vpc,
      albSecurityGroupId: serviceAlbSg.id,
      isPrivate: false,
      tags,
      idleTimeout: 3600,
    });

    this.targetGroup = targetGroup;
    this.lb = lb;
    this.listener = listener;

    const secretPolicy = new aws.iam.Policy(
      `${BASE_NAME}-secrets-policy-${stack}`,
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

    this.role = new aws.iam.Role(
      `${BASE_NAME}-task-role`,
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
        managedPolicyArns: [queuePolicy.arn, secretPolicy.arn],
        tags,
      },
      { parent: this }
    );

    this.service = new awsx.ecs.FargateService(
      `${BASE_NAME}`,
      {
        cluster: ecsClusterArn,
        tags,
        networkConfiguration: {
          subnets: vpc.privateSubnetIds,
          securityGroups: [serviceSg.id],
        },
        desiredCount: 1,
        taskDefinitionArgs: {
          taskRole: {
            roleArn: this.role.arn,
          },
          containers: {
            log_router: fargateLogRouterSidecarContainer,
            datadog_agent: datadogAgentContainer,
            service: {
              name: BASE_NAME,
              image: image.image.imageUri,
              cpu: 256,
              memory: 512,
              environment: envVars,
              essential: true,
              portMappings: [
                {
                  containerPort: port,
                  hostPort: port,
                  appProtocol: 'http',
                  targetGroup,
                  name: `${BASE_NAME}-tcp-${stack}`,
                },
              ],
              logConfiguration: {
                logDriver: 'awsfirelens',
                options: {
                  Name: 'datadog',
                  Host: 'http-intake.logs.us5.datadoghq.com',
                  apikey: DATADOG_API_KEY,
                  dd_service: `${BASE_NAME}-${stack}`,
                  dd_source: 'fargate',
                  dd_tags: `project:unfurl-service, env:${stack}`,
                  provider: 'ecs',
                },
              },
            },
          },
          runtimePlatform: {
            operatingSystemFamily: platform.family.toUpperCase(),
            cpuArchitecture:
              platform.architecture === 'amd64' ? 'X86_64' : 'ARM64',
          },
        },
      },
      { parent: this }
    );

    const zone = aws.route53.getZoneOutput({ name: BASE_DOMAIN });

    new aws.route53.Record(
      `${BASE_NAME}-domain-record`,
      {
        name: `${USER_INSIGHT_DOMAIN_NAME}`,
        type: 'A',
        zoneId: zone.zoneId,
        aliases: [
          {
            evaluateTargetHealth: false,
            name: lb.dnsName,
            zoneId: lb.zoneId,
          },
        ],
      },
      { parent: this }
    );

    this.domain = `https://${USER_INSIGHT_DOMAIN_NAME}`;
  }
}
