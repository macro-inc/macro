// Preserve the public hostname and durable queue; all compute runs in the harness.
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Queue } from '../../packages/resources';
import {
  AGENT_PUBLIC_URLS,
  BASE_DOMAIN,
  getGatewayAlb,
  stack,
} from '../../packages/shared';

const gateway = getGatewayAlb();
const zone = aws.route53.getZoneOutput({ name: BASE_DOMAIN });
new aws.route53.Record(
  'document-cognition-domain-record',
  {
    name: new URL(AGENT_PUBLIC_URLS.cognition).hostname,
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
    // Move the existing record out of the retired component without replacing it.
    aliases: [
      {
        parent: pulumi.createUrn(
          `document-cognition-service-${stack}`,
          'my:components:DocumentCognitionService'
        ),
      },
    ],
  }
);
export const documentCognitionServiceUrl = AGENT_PUBLIC_URLS.cognition;

const aiProjectionQueue = new Queue('ai-projection', {
  tags: {
    environment: stack,
    env: stack,
    tech_lead: 'ehayes',
    project: 'document-cognition-service',
    service: 'document-cognition-service',
  },
  maxReceiveCount: 2,
  visibilityTimeoutSeconds: 120,
});
export const aiProjectionQueueArn = aiProjectionQueue.queue.arn;
export const aiProjectionQueueName = aiProjectionQueue.queue.name;
