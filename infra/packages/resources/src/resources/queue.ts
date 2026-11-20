import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '../../../shared';
import type { QueueAlarmOptions } from './queue_alarms';
import { QueueAlarms } from './queue_alarms';

type Args = {
  alarm?: QueueAlarmOptions;
  // The maximum receive count of a message before it's sent to DLQ
  maxReceiveCount?: number;
  tags: { [key: string]: string };
  fifoQueue?: boolean;
  // FIFO only: deduplicate and throttle per message group instead of per
  // queue, raising the queue's throughput limit (SQS high throughput mode)
  fifoHighThroughput?: boolean;
  // Optional param for how long you have to process a message
  visibilityTimeoutSeconds?: number;
  // How long every new message stays hidden before its first delivery
  delaySeconds?: number;
  // How long SQS keeps a message after it was sent (default 4 days)
  messageRetentionSeconds?: number;
};

/**
 * @description creates a queue component which consists of a SQS queue, DLQ and alarms around the DLQ
 */
export class Queue extends pulumi.ComponentResource {
  queue: aws.sqs.Queue;
  dlq: aws.sqs.Queue;
  tags: { [key: string]: string };
  constructor(
    name: string,
    args: Args,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:Queue', name, {}, opts);
    const {
      tags,
      maxReceiveCount,
      fifoQueue,
      fifoHighThroughput,
      visibilityTimeoutSeconds,
      delaySeconds,
      messageRetentionSeconds,
    } = args;
    if (fifoHighThroughput && !fifoQueue) {
      throw new Error(`${name}: fifoHighThroughput needs fifoQueue`);
    }
    const highThroughput =
      fifoQueue && fifoHighThroughput
        ? {
            deduplicationScope: 'messageGroup',
            fifoThroughputLimit: 'perMessageGroupId',
          }
        : {};

    this.tags = tags;
    // Create queue and DLQ
    const dlqName = `${name}-dlq-${stack}${args.fifoQueue ? '.fifo' : ''}`;
    this.dlq = new aws.sqs.Queue(
      dlqName,
      {
        name: dlqName,
        messageRetentionSeconds: 1209600,
        fifoQueue: fifoQueue ?? false,
        tags,
      },
      { parent: this }
    );

    new aws.cloudwatch.MetricAlarm(
      `${name}-dlq-alarm`,
      {
        name: `${name}-dlq-alarm-${stack}`,
        comparisonOperator: 'GreaterThanThreshold',
        evaluationPeriods: 1,
        metricName: 'ApproximateNumberOfMessagesVisible',
        namespace: 'AWS/SQS',
        period: 60,
        statistic: 'Average',
        threshold: 0,
        dimensions: {
          QueueName: this.dlq.name,
        },
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this }
    );

    const queueName = `${name}-queue-${stack}${fifoQueue ? '.fifo' : ''}`;
    this.queue = new aws.sqs.Queue(
      queueName,
      {
        name: queueName,
        redrivePolicy: this.dlq.arn.apply((arn: string) =>
          JSON.stringify({
            deadLetterTargetArn: arn,
            maxReceiveCount: maxReceiveCount ?? 5,
          })
        ),
        fifoQueue: args.fifoQueue ?? false,
        ...highThroughput,
        visibilityTimeoutSeconds: visibilityTimeoutSeconds ?? 30,
        delaySeconds,
        messageRetentionSeconds,
        tags,
      },
      { parent: this, dependsOn: [this.dlq] }
    );

    new QueueAlarms(
      `${name}-alarm`,
      { ...args.alarm, queue: this.queue, tags },
      { parent: this }
    );
  }
}
