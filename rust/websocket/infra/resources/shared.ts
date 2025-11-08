import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
export const awsRegion = aws.config.region!;
if (!awsRegion) {
  throw new Error('AWS region not specified');
}

export const accountId = aws
  .getCallerIdentity()
  .then(identity => identity.accountId);

export const project = pulumi.getProject();
export const stack = pulumi.getStack();

export const standardConfig = new pulumi.Config('websocket-connection');

export const MACRO_ORG_NAME = 'macro-inc';
export const BASE_DOMAIN = 'macro.com';

export const MACRO_SUBDOMAIN_CERT =
  'arn:aws:acm:us-east-1:569036502058:certificate/a75b1b07-534c-44e1-b59b-fa5f74fd8069';

export const DATADOG_KINESIS_FIREHOSE_STREAM_ARN =
  'arn:aws:firehose:us-east-1:569036502058:deliverystream/datadog-kinesis-stream';
export const CLOUDWATCH_KINESIS_STREAM_ROLE_ARN =
  'arn:aws:iam::569036502058:role/cloudwatch-kinesis-stream-role';

export const tags = {
  environment: stack,
  tech_lead: 'gab',
  project: 'websocket',
};
