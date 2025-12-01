import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { CLOUD_TRAIL_SNS_TOPIC_ARN } from '@shared';

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

    const { queue } = args;

    const tags = { ...args.tags, queue: queue.name };

    const approximateAgeOfOldestMessageEvaluationPeriods =
      args.approximateAgeOfOldestMessageEvaluationPeriods ?? 60;
    const approximateAgeOfOldestMessageThreshold =
      args.approximateAgeOfOldestMessageThreshold ?? 120; // 2 minutes

    // alarm for monitoring ApproximateAgeOfOldestMessage
    this.queueApproximateAgeOfOldestMessageAlarm =
      new aws.cloudwatch.MetricAlarm(
        `${name}-aaoom`,
        {
          alarmDescription: `Alarm when ${queue.name} has approximate age of oldest message over ${approximateAgeOfOldestMessageThreshold}s for ${approximateAgeOfOldestMessageEvaluationPeriods}s.`,
          comparisonOperator: 'GreaterThanThreshold',
          evaluationPeriods: 1,
          metricName: 'ApproximateAgeOfOldestMessage',
          namespace: 'AWS/SQS',
          period: approximateAgeOfOldestMessageEvaluationPeriods,
          statistic: 'Average',
          threshold: approximateAgeOfOldestMessageThreshold,
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
