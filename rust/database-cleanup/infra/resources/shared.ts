import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
export const awsRegion = aws.config.region!;
if (!awsRegion) {
  throw new Error('AWS region not specified');
}

export const project = pulumi.getProject();
export const stack = pulumi.getStack();

export const config = new pulumi.Config();

export const MACRO_ORG_NAME = 'macro-inc';
export const DATABASE_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_secret_key`),
  })
  .apply(secret => secret.secretString);

export const CLOUD_TRAIL_SNS_TOPIC_ARN =
  'arn:aws:sns:us-east-1:569036502058:CloudTrailSNS';

export const DATADOG_KINESIS_FIREHOSE_STREAM_ARN = 'arn:aws:firehose:us-east-1:569036502058:deliverystream/datadog-kinesis-stream';
export const CLOUDWATCH_KINESIS_STREAM_ROLE_ARN = 'arn:aws:iam::569036502058:role/cloudwatch-kinesis-stream-role';
