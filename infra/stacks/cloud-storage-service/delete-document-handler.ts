// This file used to contain a lambda that hooked into the queue. This was not effective due to the time it takes to delete items from s3.
// We keep the structure the same here to make it easier to not break the existing code.

import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '@shared';

const BASE_NAME = 'delete-document-handler';

type Args = {
  tags: { [key: string]: string };
};

export class DeleteDocumentHandler extends pulumi.ComponentResource {
  queue: aws.sqs.Queue;
  dlq: aws.sqs.Queue;
  tags: { [key: string]: string };
  constructor(
    name: string,
    args: Args,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:DeleteDocumentHandler', name, {}, opts);
    const { tags } = args;

    this.tags = tags;

    // Create queue and DLQ
    this.dlq = new aws.sqs.Queue(
      `${BASE_NAME}-dlq-${stack}`,
      {
        name: `${BASE_NAME}-dlq-${stack}`,
        messageRetentionSeconds: 1209600,
        tags,
      },
      { parent: this }
    );

    new aws.cloudwatch.MetricAlarm(
      'dlq-alarm',
      {
        name: `${BASE_NAME}-dlq-alarm-${stack}`,
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

    this.queue = new aws.sqs.Queue(
      `${BASE_NAME}-queue-${stack}`,
      {
        name: `${BASE_NAME}-queue-${stack}`,
        redrivePolicy: this.dlq.arn.apply((arn) =>
          JSON.stringify({
            deadLetterTargetArn: arn,
            maxReceiveCount: 5,
          })
        ),
        tags,
      },
      { parent: this, dependsOn: [this.dlq] }
    );
  }
}
