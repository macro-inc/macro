import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '@shared';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'cloud-storage-search',
};

const BASE_NAME = 'search-event-queue';

const SEARCH_TEAM_EMAILS = ['hutch@macro.com', 'evan@macro.com'];

// SNS Topic for email notifications
const emailTopic = new aws.sns.Topic('email-topic', {
  name: `${BASE_NAME}-alerts-${stack}`,
  tags,
});

for (const email of SEARCH_TEAM_EMAILS) {
  new aws.sns.TopicSubscription(`email-subscription-${email}`, {
    topic: emailTopic.arn,
    protocol: 'email',
    endpoint: email,
  });
}

const dlq = new aws.sqs.Queue('dlq', {
  name: `${BASE_NAME}-dlq-${stack}`,
  fifoQueue: false,
  messageRetentionSeconds: 1209600,
  tags,
});

// TODO: we may need to tweak the queues settings here
const queue = new aws.sqs.Queue(
  'queue',
  {
    name: `${BASE_NAME}-${stack}`,
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

if (stack === 'prod') {
  new aws.cloudwatch.MetricAlarm('dlq-alarm', {
    name: `${BASE_NAME}-dlq-alarm-${stack}`,
    comparisonOperator: 'GreaterThanThreshold',
    evaluationPeriods: 1,
    metricName: 'ApproximateNumberOfMessagesVisible',
    namespace: 'AWS/SQS',
    period: 60,
    statistic: 'Average',
    threshold: 100, // if we hit 100 messages in the queue we should investigate
    dimensions: {
      QueueName: dlq.name,
    },
    alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
    tags,
  });

  // Alarm for approximate age of oldest message
  new aws.cloudwatch.MetricAlarm('queue-age-alarm', {
    name: `${BASE_NAME}-age-alarm-${stack}`,
    comparisonOperator: 'GreaterThanThreshold',
    evaluationPeriods: 2,
    metricName: 'ApproximateAgeOfOldestMessage',
    namespace: 'AWS/SQS',
    period: 300, // 5 minutes
    statistic: 'Maximum',
    threshold: 900, // 15 minutes in seconds
    dimensions: {
      QueueName: queue.name,
    },
    alarmActions: [emailTopic.arn],
    treatMissingData: 'notBreaching',
    tags,
  });

  // Alarm for approximate number of messages visible
  new aws.cloudwatch.MetricAlarm('queue-messages-alarm', {
    name: `${BASE_NAME}-messages-alarm-${stack}`,
    comparisonOperator: 'GreaterThanThreshold',
    evaluationPeriods: 2,
    metricName: 'ApproximateNumberOfMessagesVisible',
    namespace: 'AWS/SQS',
    period: 300, // 5 minutes
    statistic: 'Average',
    threshold: 1000,
    dimensions: {
      QueueName: queue.name,
    },
    alarmActions: [emailTopic.arn],
    tags,
  });
}

export const searchEventQueueArn = pulumi.interpolate`${queue.arn}`;
export const searchEventQueueName = pulumi.interpolate`${queue.name}`;
export const emailTopicArn = pulumi.interpolate`${emailTopic.arn}`;
