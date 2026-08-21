import { stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { MacroApplicationLoadBalancer } from '../../packages/resources';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'gateway',
};

const vpc = get_coparse_api_vpc();

const gatewayApplicationLoadBalancer = new MacroApplicationLoadBalancer(
  `${stack}-gateway`,
  {
    // We want `gateway.macro.com` for prod and `${stack}-gateway` for all non-prod environments
    subDomain: stack === 'prod' ? 'gateway' : `${stack}-gateway`,
    tags,
    isInternal: false,
    idleTimeout: 3600, // This was derived from max idleTimeout used in existing service application load balancers
    vpc,
  }
);

/** ARN of the gateway ALB */
export const albArn = gatewayApplicationLoadBalancer.load_balancer.arn;

/** ARN of the HTTPS listener that service stacks attach their listener rules to */
export const httpsListenerArn =
  gatewayApplicationLoadBalancer.https_listener.arn;

/** Security group of the gateway ALB, for service SG ingress/egress pairing */
export const albSecurityGroupId =
  gatewayApplicationLoadBalancer.loadbalancer_security_group.id;

/** DNS name of the gateway ALB, for Route53 alias records in service stacks */
export const albDnsName = gatewayApplicationLoadBalancer.load_balancer.dnsName;

/** Canonical hosted zone of the gateway ALB (alias record target zone) */
export const albZoneId = gatewayApplicationLoadBalancer.load_balancer.zoneId;

/** ALB arn suffix (`app/...`) for CloudWatch dimensions and autoscaling resource labels */
export const albArnSuffix =
  gatewayApplicationLoadBalancer.load_balancer.arnSuffix;
