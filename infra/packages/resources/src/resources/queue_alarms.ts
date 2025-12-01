import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '@shared';

type Args = {
  // The queue to create alarms for
  queue: aws.sqs.Queue;
  // The tags to apply to the alarms
  tags: { [key: string]: string };
  // The evaluation periods for the alarm
  // Defaults to 60s
  approximateAgeOfOldestMessageEvaluationPeriods?: number;
  // The threshold for the alarm
  // Defaults to 120s
  approximateAgeOfOldestMessageThreshold?: number;
};

/**
 * @description Creates default queue alarms for a provided queue.
 */
export class QueueAlarms extends pulumi.ComponentResource {
  queueApproximateAgeOfOldestMessageAlarm: aws.cloudwatch.MetricAlarm;
  constructor(
    name: string,
    args: Args,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:QueueAlarms', name, { tags: args.tags }, opts);

    const { queue, approximateAgeOfOldestMessageEvaluationPeriods, approximateAgeOfOldestMessageThreshold } = args;

    const tags = { ...args.tags, queue: queue.name };


    // alarm for monitoring ApproximateAgeOfOldestMessage
    this.queueApproximateAgeOfOldestMessageAlarm = new aws.cloudwatch.MetricAlarm(
      'approximate-age-of-oldest-message-alarm',
      {
        name: `${queue.name}-queue-approximate-age-of-oldest-message-alarm-${stack}`,
        comparisonOperator: 'GreaterThanThreshold',
        evaluationPeriods: 1,
        metricName: 'ApproximateAgeOfOldestMessage',
        namespace: 'AWS/SQS',
        period: approximateAgeOfOldestMessageEvaluationPeriods ?? 60,
        statistic: 'Average',
        threshold: approximateAgeOfOldestMessageThreshold ?? 120, // 2 minutes
        dimensions: {
          QueueName: queue.name,
        },
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags,
      },
      { parent: this }
    );
  }
}
