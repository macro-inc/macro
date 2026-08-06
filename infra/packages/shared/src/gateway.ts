import * as pulumi from '@pulumi/pulumi';
import { MACRO_ORG_NAME, stack } from '.';

/**
 * Outputs exported by the gateway stack (`infra/stacks/gateway`).
 */
export type GatewayAlb = {
  /** ARN of the gateway ALB */
  albArn: pulumi.Output<string>;
  /** ARN of the HTTPS listener that service stacks attach their listener rules to */
  httpsListenerArn: pulumi.Output<string>;
  /** Security group of the gateway ALB, for service SG ingress/egress pairing */
  albSecurityGroupId: pulumi.Output<string>;
  /** DNS name of the gateway ALB, for Route53 alias records in service stacks */
  albDnsName: pulumi.Output<string>;
  /** Canonical hosted zone of the gateway ALB (alias record target zone) */
  albZoneId: pulumi.Output<string>;
  /** ALB arn suffix (`app/...`) for CloudWatch dimensions and autoscaling resource labels */
  albArnSuffix: pulumi.Output<string>;
};

/**
 * Singleton for the gateway stack reference
 */
let _GATEWAY_ALB: GatewayAlb | undefined = undefined;

/**
 * Gets the shared gateway ALB outputs for the current stack.
 *
 * Fails at deploy time if the gateway stack has not been deployed in this
 * environment yet.
 */
export function getGatewayAlb(): GatewayAlb {
  if (_GATEWAY_ALB) {
    return _GATEWAY_ALB;
  }

  const gatewayStack = new pulumi.StackReference('gateway-stack', {
    name: `${MACRO_ORG_NAME}/gateway/${stack}`,
  });

  const requireString = (output: string): pulumi.Output<string> =>
    gatewayStack.requireOutput(output) as pulumi.Output<string>;

  _GATEWAY_ALB = {
    albArn: requireString('albArn'),
    httpsListenerArn: requireString('httpsListenerArn'),
    albSecurityGroupId: requireString('albSecurityGroupId'),
    albDnsName: requireString('albDnsName'),
    albZoneId: requireString('albZoneId'),
    albArnSuffix: requireString('albArnSuffix'),
  };

  return _GATEWAY_ALB;
}
