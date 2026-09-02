import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
export const awsRegion = aws.config.region!;
if (!awsRegion) {
  throw new Error('AWS region not specified');
}

export const project = pulumi.getProject();

export const stack = pulumi.getStack();

export const config = new pulumi.Config();

export const MACRO_ORG_NAME = 'macro-inc';

export const RDS_PORT = 5432;

export const PULUMI_AUTHORIZER_STACK = 'macro-authorizer-lambda';

export const SERVICE_NAME = 'doc-storage';

export const BASE_DOMAIN = 'macro.com';

/**
 * Legacy per-service hostname for DSS. Still backs the dedicated ALB and its
 * Route53 alias record during the gateway cutover, so it must remain a bare
 * hostname — never give it a scheme or a path.
 */
export const SERVICE_DOMAIN_NAME = `cloud-storage${
  stack === 'dev' ? '-dev' : ''
}.${BASE_DOMAIN}`;

/**
 * Public base URL for DSS behind the shared gateway ALB, which routes the
 * `/dss` path prefix to the service. Callers append paths by concatenation, so
 * this must not end with a trailing slash.
 */
export const DOCUMENT_STORAGE_GATEWAY_URL = `https://${
  stack === 'prod' ? '' : `${stack}-`
}gateway.${BASE_DOMAIN}/dss`;

export const MACRO_SUBDOMAIN_CERT =
  'arn:aws:acm:us-east-1:569036502058:certificate/a75b1b07-534c-44e1-b59b-fa5f74fd8069';

export const CLOUD_TRAIL_SNS_TOPIC_ARN =
  'arn:aws:sns:us-east-1:569036502058:CloudTrailSNS';

export const DATADOG_KINESIS_FIREHOSE_STREAM_ARN =
  'arn:aws:firehose:us-east-1:569036502058:deliverystream/datadog-kinesis-stream';

export const CLOUDWATCH_KINESIS_STREAM_ROLE_ARN =
  'arn:aws:iam::569036502058:role/cloudwatch-kinesis-stream-role';

export { getMacroApiToken } from './macro_api_token';
export { getMacroNotify } from './macro_notify';
export { getSearchEventQueue } from './search_event_queue';
export { getLinkManagerQueue } from './link_manager_queue';
export { getBackfillQueue } from './backfill_queue';
export { DopplerEcsEnvironment } from './doppler_environment';
export {
  getAiToolsInfra,
  getAiToolsServiceRoleArns,
  type AiToolsInfra,
} from './ai_tools';
export { getKafkaClusterPolicy } from './kafka_cluster_policy';
export { getGatewayAlb, type GatewayAlb } from './gateway';
export { GATEWAY_PRIORITIES, GatewayService } from './gateway_priorities';

export * from './service_urls';
