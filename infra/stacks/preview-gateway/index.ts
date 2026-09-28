import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import * as dopplerProvider from '@pulumiverse/doppler';
import { ServiceTargetGroup } from '../../packages/resources';
import { EcrImage } from '../../packages/service';
import {
  config,
  DopplerEcsEnvironment,
  getGatewayAlb,
  getMacroApiToken,
  GatewayService,
  stack,
} from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';

const name = 'preview-gateway';
const tags = {
  environment: stack,
  env: stack,
  project: name,
  service: name,
  tech_lead: 'wolf',
};
const vpc = get_coparse_api_vpc();
const gateway = getGatewayAlb();
// A separate registrable domain is mandatory: previews execute agent-authored JavaScript.
const domain = config.require('preview_domain');
if (
  domain === 'macro.com' ||
  domain.endsWith('.macro.com') ||
  !/^[a-z0-9.-]+$/.test(domain)
) {
  throw new Error(
    'preview_domain must be an isolated DNS name outside macro.com'
  );
}
const zoneId = config.require('preview_zone_id');
const sshHost = `ssh.${domain}`;
const certificate = new aws.acm.Certificate(`${name}-${stack}`, {
  domainName: `*.${domain}`,
  validationMethod: 'DNS',
  tags,
});
const validation = certificate.domainValidationOptions.apply((options) =>
  options.map(
    (option, i) =>
      new aws.route53.Record(`${name}-validation-${i}-${stack}`, {
        zoneId,
        name: option.resourceRecordName,
        type: option.resourceRecordType,
        records: [option.resourceRecordValue],
        ttl: 60,
      })
  )
);
const validated = new aws.acm.CertificateValidation(`${name}-${stack}`, {
  certificateArn: certificate.arn,
  validationRecordFqdns: validation.apply((records) =>
    records.map((record) => record.fqdn)
  ),
});
const albSg = new aws.ec2.SecurityGroup(`${name}-http-${stack}`, {
  vpcId: vpc.vpcId,
  tags,
  ingress: [
    { protocol: 'tcp', fromPort: 443, toPort: 443, cidrBlocks: ['0.0.0.0/0'] },
  ],
  egress: [
    {
      protocol: 'tcp',
      fromPort: 8110,
      toPort: 8111,
      cidrBlocks: ['0.0.0.0/0'],
    },
  ],
});
const sshSg = new aws.ec2.SecurityGroup(`${name}-ssh-${stack}`, {
  vpcId: vpc.vpcId,
  tags,
  ingress: [
    { protocol: 'tcp', fromPort: 22, toPort: 22, cidrBlocks: ['0.0.0.0/0'] },
  ],
  egress: [2222, 8110].map((port) => ({
    protocol: 'tcp',
    fromPort: port,
    toPort: port,
    cidrBlocks: ['0.0.0.0/0'],
  })),
});
const taskSg = new aws.ec2.SecurityGroup(`${name}-task-${stack}`, {
  vpcId: vpc.vpcId,
  tags,
});
for (const [index, rule] of [
  { fromPort: 8110, toPort: 8111, source: albSg.id },
  { fromPort: 2222, toPort: 2222, source: sshSg.id },
  { fromPort: 8110, toPort: 8110, source: sshSg.id },
].entries()) {
  new aws.vpc.SecurityGroupIngressRule(
    `${name}-task-ingress-${index}-${stack}`,
    {
      securityGroupId: taskSg.id,
      ipProtocol: 'tcp',
      fromPort: rule.fromPort,
      toPort: rule.toPort,
      referencedSecurityGroupId: rule.source,
    }
  );
}
new aws.vpc.SecurityGroupEgressRule(`${name}-task-egress-${stack}`, {
  securityGroupId: taskSg.id,
  ipProtocol: '-1',
  cidrIpv4: '0.0.0.0/0',
});

const control = new ServiceTargetGroup(`${name}-${stack}`, {
  tags,
  listenerArn: gateway.httpsListenerArn,
  vpcId: vpc.vpcId,
  containerPort: 8110,
  service: GatewayService.PREVIEW_GATEWAY,
  healthCheckPath: '/health',
  pathPatterns: ['/preview', '/preview/*'],
  serviceSecurityGroupId: taskSg.id,
  albSecurityGroupId: gateway.albSecurityGroupId,
});
const httpAlb = new aws.lb.LoadBalancer(`${name}-http-${stack}`, {
  loadBalancerType: 'application',
  subnets: vpc.publicSubnetIds,
  securityGroups: [albSg.id],
  idleTimeout: 3600,
  dropInvalidHeaderFields: true,
  tags,
});
const httpTarget = new aws.lb.TargetGroup(`${name}-http-${stack}`, {
  port: 8111,
  protocol: 'HTTP',
  targetType: 'ip',
  vpcId: vpc.vpcId,
  deregistrationDelay: 0,
  healthCheck: { protocol: 'HTTP', port: '8110', path: '/health' },
  tags,
});
const httpListener = new aws.lb.Listener(`${name}-https-${stack}`, {
  loadBalancerArn: httpAlb.arn,
  port: 443,
  protocol: 'HTTPS',
  certificateArn: validated.certificateArn,
  sslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
  defaultActions: [{ type: 'forward', targetGroupArn: httpTarget.arn }],
  tags,
});
const sshNlb = new aws.lb.LoadBalancer(`${name}-ssh-${stack}`, {
  loadBalancerType: 'network',
  subnets: vpc.publicSubnetIds,
  securityGroups: [sshSg.id],
  enableCrossZoneLoadBalancing: true,
  tags,
});
const sshTarget = new aws.lb.TargetGroup(`${name}-ssh-${stack}`, {
  port: 2222,
  protocol: 'TCP',
  targetType: 'ip',
  vpcId: vpc.vpcId,
  deregistrationDelay: 0,
  healthCheck: { protocol: 'HTTP', port: '8110', path: '/health' },
  tags,
});
const sshListener = new aws.lb.Listener(`${name}-ssh-${stack}`, {
  loadBalancerArn: sshNlb.arn,
  port: 22,
  protocol: 'TCP',
  defaultActions: [{ type: 'forward', targetGroupArn: sshTarget.arn }],
});
new aws.route53.Record(`${name}-wildcard-${stack}`, {
  zoneId,
  name: `*.${domain}`,
  type: 'A',
  aliases: [
    {
      name: httpAlb.dnsName,
      zoneId: httpAlb.zoneId,
      evaluateTargetHealth: true,
    },
  ],
});
new aws.route53.Record(`${name}-ssh-${stack}`, {
  zoneId,
  name: sshHost,
  type: 'A',
  aliases: [
    { name: sshNlb.dnsName, zoneId: sshNlb.zoneId, evaluateTargetHealth: true },
  ],
});
const image = new EcrImage(`${name}-${stack}`, {
  repositoryId: `${name}-ecr-${stack}`,
  repositoryName: `${name}-${stack}`,
  imageId: `${name}-image-${stack}`,
  imagePath: '../../..',
  dockerfile: 'docker/Dockerfile',
  platform: { family: 'linux', architecture: 'amd64' },
  buildArgs: { SERVICE_NAME: 'preview_gateway' },
  tags,
});
// MacroConfig reads APP_SECRETS_JSON as a complete configuration. Keep deployment
// addresses in Doppler, which syncs that JSON into Secrets Manager for ECS.
const deploymentConfig = {
  PORT: '8110',
  ENVIRONMENT: stack,
  PREVIEW_DOMAIN: domain,
  PREVIEW_SSH_HOST: sshHost,
  // Local stacks reach their SSH listener through a Cloudflare quick tunnel;
  // a deployed gateway is dialled directly and rejects a proxy host outright.
  // Present-but-empty because MacroConfig does not merge missing JSON keys.
  PREVIEW_SSH_PROXY_HOST: '',
  PREVIEW_APP_ORIGIN:
    stack === 'prod' ? 'https://macro.com' : 'https://dev.macro.com',
  PREVIEW_CONTROL_HOSTS:
    stack === 'prod' ? 'gateway.macro.com' : 'dev-gateway.macro.com',
};
const configSecrets = Object.entries(deploymentConfig).map(
  ([key, value]) =>
    new dopplerProvider.Secret(`${name}-${key}-${stack}`, {
      project: name,
      config: stack === 'prod' ? 'prd' : 'dev',
      name: key,
      value,
    })
);
const doppler = new DopplerEcsEnvironment(name, { tags });
const role = new aws.iam.Role(`${name}-${stack}`, {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: 'ecs-tasks.amazonaws.com',
  }),
  tags,
});
const fusionKey = aws.secretsmanager.getSecretVersionOutput({
  secretId: `fusionauth-jwt-secret-${stack}`,
});
new aws.iam.RolePolicy(`${name}-auth-${stack}`, {
  role: role.id,
  policy: pulumi.jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['secretsmanager:GetSecretValue'],
        Resource: [fusionKey.arn, getMacroApiToken().macroApiTokenPublicKeyArn],
      },
    ],
  }),
});
const cluster = new pulumi.StackReference(`${name}-cluster`, {
  name: `macro-inc/document-storage/${stack}`,
});
const logs = new aws.cloudwatch.LogGroup(`${name}-${stack}`, {
  retentionInDays: 14,
  tags,
});
const service = new awsx.ecs.FargateService(
  `${name}-${stack}`,
  {
    cluster: cluster.requireOutput(
      'cloudStorageClusterArn'
    ) as pulumi.Output<string>,
    networkConfiguration: {
      subnets: vpc.privateSubnetIds,
      securityGroups: [taskSg.id],
    },
    // SSH and HTTP must reach the same registry. Do not autoscale or overlap deployments.
    desiredCount: 1,
    deploymentMinimumHealthyPercent: 0,
    deploymentMaximumPercent: 100,
    deploymentCircuitBreaker: { enable: true, rollback: true },
    healthCheckGracePeriodSeconds: 120,
    loadBalancers: [control.target_group, httpTarget, sshTarget].map(
      (target, i) => ({
        targetGroupArn: target.arn,
        containerName: 'service',
        containerPort: [8110, 8111, 2222][i],
      })
    ),
    taskDefinitionArgs: {
      taskRole: { roleArn: role.arn },
      executionRole: { roleArn: doppler.executionRole.arn },
      runtimePlatform: {
        operatingSystemFamily: 'LINUX',
        cpuArchitecture: 'X86_64',
      },
      containers: {
        service: {
          name: 'service',
          image: image.image.imageUri,
          cpu: 1024,
          memory: 2048,
          essential: true,
          stopTimeout: 30,
          secrets: doppler.containerSecrets,
          environment: [
            { name: 'PORT', value: '8110' },
            { name: 'ENVIRONMENT', value: stack },
            { name: 'DD_SERVICE', value: name },
            { name: 'DD_ENV', value: stack },
          ],
          logConfiguration: {
            logDriver: 'awslogs',
            options: {
              'awslogs-group': logs.name,
              'awslogs-region': aws.getRegionOutput().name,
              'awslogs-stream-prefix': 'gateway',
            },
          },
          portMappings: [8110, 8111, 2222].map((port) => ({
            containerPort: port,
            hostPort: port,
            protocol: 'tcp',
          })),
        },
      },
    },
    tags,
  },
  { dependsOn: [httpListener, sshListener, ...configSecrets] }
);
export const previewDomain = domain;
export const previewSshHost = sshHost;
export const previewServiceArn = service.service.id;
