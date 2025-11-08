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
export const BASE_DOMAIN = 'macro.com';

export const MACRO_SUBDOMAIN_CERT =
  'arn:aws:acm:us-east-1:569036502058:certificate/a75b1b07-534c-44e1-b59b-fa5f74fd8069';

export const CLOUD_TRAIL_SNS_TOPIC_ARN =
  'arn:aws:sns:us-east-1:569036502058:CloudTrailSNS';

export const DOCUMENT_STORAGE_SERVICE_AUTH_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.get(`document_storage_service_auth_key`) ?? '',
  })
  .apply((secret) => secret.secretString);

export const DATABASE_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_secret_key`),
  })
  .apply((secret) => secret.secretString);

export const DATABASE_URL_PROXY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_proxy_secret_key`),
  })
  .apply((secret) => secret.secretString);

export const DATADOG_KINESIS_FIREHOSE_STREAM_ARN =
  'arn:aws:firehose:us-east-1:569036502058:deliverystream/datadog-kinesis-stream';
export const CLOUDWATCH_KINESIS_STREAM_ROLE_ARN =
  'arn:aws:iam::569036502058:role/cloudwatch-kinesis-stream-role';
