import * as aws from '@pulumi/aws';
import { config, stack } from '@shared';
import { DlpHandler } from './dlp-handler';

if (stack === 'prod') {
  const tags = {
    environment: stack,
    tech_lead: 'hutch',
    project: 'dlp-handler',
  };

  const snsTopicArn = config.require('sns-topic-arn');
  const loggingBucketArn = config.require('logging-bucket-arn');

  const dlpHandler = new DlpHandler(`dlp-handler-${stack}`, {
    envVars: {
      SNS_TOPIC_ARN: snsTopicArn,
      RUST_LOG: 'dataloss_prevention_handler=info',
      ENVIRONMENT: stack,
    },
    snsTopicArn,
    loggingBucketArn,
    tags,
  });

  // Extract bucket name from ARN
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const bucketName = loggingBucketArn.split(':').pop()!;

  const existingBucket = aws.s3.Bucket.get(
    `existing-bucket-${stack}`,
    bucketName
  );

  new aws.s3.BucketEventSubscription(
    `doc-access-event-${stack}`,
    existingBucket,
    dlpHandler.lambda,

    {
      events: ['s3:ObjectCreated:*'],
      filterPrefix: 'macro-document-storage-prod/',
    }
  );

  // TODO: add in s3 event
}
