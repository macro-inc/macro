import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '@shared';
import { UPLOAD_EXTRACTOR_LAMBDA_TIMEOUT_SECONDS } from './upload-extractor-lambda-handler';

interface BulkUploadQueueArgs {
  tags: { [key: string]: string };
}

export class BulkUploadQueue extends pulumi.ComponentResource {
  queue: aws.sqs.Queue;
  dlq: aws.sqs.Queue;

  constructor(
    name: string,
    args: BulkUploadQueueArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:BulkUploadQueue', name, {}, opts);
    const { tags } = args;

    this.dlq = new aws.sqs.Queue(
      `bulk-upload-dlq-${stack}`,
      {
        name: `bulk-upload-dlq-${stack}`,
        messageRetentionSeconds: 1209600,
        tags,
      },
      { parent: this }
    );

    new aws.cloudwatch.MetricAlarm(
      'dlq-alarm',
      {
        name: `bulk-upload-dlq-alarm-${stack}`,
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
        tags,
      },
      { parent: this }
    );

    this.queue = new aws.sqs.Queue(
      `bulk-upload-queue-${stack}`,
      {
        name: `bulk-upload-queue-${stack}`,
        redrivePolicy: this.dlq.arn.apply((arn) =>
          JSON.stringify({
            deadLetterTargetArn: arn,
            maxReceiveCount: 5,
          })
        ),
        visibilityTimeoutSeconds: UPLOAD_EXTRACTOR_LAMBDA_TIMEOUT_SECONDS + 15,
        tags,
      },
      { parent: this, dependsOn: [this.dlq] }
    );
  }
}
