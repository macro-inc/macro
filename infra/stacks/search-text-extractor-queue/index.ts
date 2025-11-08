import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '@shared';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'cloud-storage-search',
};

const BASE_NAME = 'search-text-extractor';

const dlq = new aws.sqs.Queue('dlq', {
  name: `${BASE_NAME}-dlq-${stack}.fifo`,
  fifoQueue: true,
  messageRetentionSeconds: 1209600,
  tags,
});

if (stack === 'prod') {
  new aws.cloudwatch.MetricAlarm('dlq-alarm', {
    name: `${BASE_NAME}-dlq-alarm-${stack}`,
    comparisonOperator: 'GreaterThanThreshold',
    evaluationPeriods: 1,
    metricName: 'ApproximateNumberOfMessagesVisible',
    namespace: 'AWS/SQS',
    period: 60,
    statistic: 'Average',
    threshold: 100,
    dimensions: {
      QueueName: dlq.name,
    },
    alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
    tags,
  });
}

// TODO: we may need to tweak the queues settings here
const queue = new aws.sqs.Queue(
  'queue',
  {
    name: `${BASE_NAME}-${stack}.fifo`,
    fifoQueue: true,
    contentBasedDeduplication: true,
    redrivePolicy: dlq.arn.apply((arn) =>
      JSON.stringify({
        deadLetterTargetArn: arn,
        maxReceiveCount: 2,
      })
    ),
    tags,
  },
  { dependsOn: [dlq] }
);

export const searchTextExtractorQueueArn = pulumi.interpolate`${queue.arn}`;
export const searchTextExtractorQueueName = pulumi.interpolate`${queue.name}`;
