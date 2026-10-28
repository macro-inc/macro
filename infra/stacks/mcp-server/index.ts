// Preserve the public OAuth identity and hostname; all compute runs in the harness.
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import {
  AGENT_PUBLIC_URLS,
  BASE_DOMAIN,
  getGatewayAlb,
  stack,
} from '../../packages/shared';

const gateway = getGatewayAlb();
const zone = aws.route53.getZoneOutput({ name: BASE_DOMAIN });
new aws.route53.Record(
  'mcp-server-domain-record',
  {
    name: new URL(AGENT_PUBLIC_URLS.mcp).hostname,
    type: 'A',
    zoneId: zone.zoneId,
    aliases: [
      {
        evaluateTargetHealth: false,
        name: gateway.albDnsName,
        zoneId: gateway.albZoneId,
      },
    ],
  },
  {
    aliases: [
      {
        parent: pulumi.createUrn(
          `mcp-server-${stack}`,
          'my:components:McpServer'
        ),
      },
    ],
  }
);
export const mcpServerUrl = AGENT_PUBLIC_URLS.mcp;
