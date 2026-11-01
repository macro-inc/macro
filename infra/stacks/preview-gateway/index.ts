import * as aws from '@pulumi/aws';
import { ServiceTargetGroup } from '../../packages/resources';
import {
  config,
  getGatewayAlb,
  GatewayService,
  stack,
} from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';

const name = 'preview-gateway';
// Load balancer and target group names are capped at 32 characters, auto-suffix included.
const shortName = 'pvgw';
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
      fromPort: 8101,
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
  egress: [2222, 8101].map((port) => ({
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
  { fromPort: 8101, toPort: 8111, source: albSg.id },
  { fromPort: 2222, toPort: 2222, source: sshSg.id },
  { fromPort: 8101, toPort: 8101, source: sshSg.id },
  { fromPort: 8111, toPort: 8111, source: taskSg.id },
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
  // Keep the existing target group's immutable default port. ECS registers
  // harness targets at port 8101, independently of this group's default.
  containerPort: 8110,
  service: GatewayService.PREVIEW_GATEWAY,
  healthCheckPath: '/health',
  healthCheck: { port: '8101' },
  pathPatterns: ['/preview', '/preview/*'],
  serviceSecurityGroupId: taskSg.id,
  albSecurityGroupId: gateway.albSecurityGroupId,
});
const httpAlb = new aws.lb.LoadBalancer(`${shortName}-http-${stack}`, {
  loadBalancerType: 'application',
  subnets: vpc.publicSubnetIds,
  securityGroups: [albSg.id],
  idleTimeout: 3600,
  dropInvalidHeaderFields: true,
  tags,
});
const httpTarget = new aws.lb.TargetGroup(`${shortName}-http-${stack}`, {
  port: 8111,
  protocol: 'HTTP',
  targetType: 'ip',
  vpcId: vpc.vpcId,
  deregistrationDelay: 0,
  healthCheck: { protocol: 'HTTP', port: '8101', path: '/health' },
  tags,
});
new aws.lb.Listener(`${name}-https-${stack}`, {
  loadBalancerArn: httpAlb.arn,
  port: 443,
  protocol: 'HTTPS',
  certificateArn: validated.certificateArn,
  sslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
  defaultActions: [{ type: 'forward', targetGroupArn: httpTarget.arn }],
  tags,
});
const sshNlb = new aws.lb.LoadBalancer(`${shortName}-ssh-${stack}`, {
  loadBalancerType: 'network',
  subnets: vpc.publicSubnetIds,
  securityGroups: [sshSg.id],
  enableCrossZoneLoadBalancing: true,
  tags,
});
const sshTarget = new aws.lb.TargetGroup(`${shortName}-ssh-${stack}`, {
  port: 2222,
  protocol: 'TCP',
  targetType: 'ip',
  vpcId: vpc.vpcId,
  deregistrationDelay: 0,
  healthCheck: { protocol: 'HTTP', port: '8101', path: '/health' },
  tags,
});
new aws.lb.Listener(`${name}-ssh-${stack}`, {
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
// The agent harness is the sole compute host; this stack owns networking only.
export const previewDomain = domain;
export const previewSshHost = sshHost;
export const previewTaskSecurityGroupId = taskSg.id;
export const previewControlTargetGroupArn = control.target_group.arn;
export const previewHttpTargetGroupArn = httpTarget.arn;
export const previewSshTargetGroupArn = sshTarget.arn;
