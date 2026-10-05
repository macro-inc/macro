import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Queue } from '../../packages/resources/src/resources/queue';

interface SlackImportQueueArgs {
  stagingBucketArn: pulumi.Input<string>;
  notificationIngressQueueArn: pulumi.Input<string>;
  tags: { [key: string]: string };
}

/** Independent worker queue and policies; DSS only signs and verifies uploads.
 * The worker policy also grants sqs:SendMessage on the notification ingress queue.
 */
export class SlackImportQueue extends pulumi.ComponentResource {
  readonly queue: aws.sqs.Queue;
  readonly dlq: aws.sqs.Queue;
  readonly uploadPolicy: aws.iam.Policy;
  readonly workerPolicy: aws.iam.Policy;

  constructor(
    name: string,
    {
      stagingBucketArn,
      notificationIngressQueueArn,
      tags,
    }: SlackImportQueueArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:SlackImportQueue', name, {}, opts);

    const queue = new Queue(
      'slack-import',
      { tags, maxReceiveCount: 5, visibilityTimeoutSeconds: 900 },
      { parent: this }
    );
    this.queue = queue.queue;
    this.dlq = queue.dlq;

    const stagingObjects = pulumi.interpolate`${stagingBucketArn}/slack-import/*`;
    this.uploadPolicy = new aws.iam.Policy(
      `${name}-upload-policy`,
      {
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              // HeadObject verification is authorized by GetObject, not HeadObject.
              Action: ['s3:PutObject', 's3:GetObject'],
              Resource: [stagingObjects],
            },
          ],
        },
        tags,
      },
      { parent: this }
    );

    // Attach this policy to the independent Fargate worker's task role.
    this.workerPolicy = new aws.iam.Policy(
      `${name}-worker-policy`,
      {
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['s3:GetObject'],
              Resource: [stagingObjects],
            },
            {
              Effect: 'Allow',
              Action: [
                'sqs:GetQueueUrl',
                'sqs:ReceiveMessage',
                'sqs:DeleteMessage',
                'sqs:ChangeMessageVisibility',
              ],
              Resource: [this.queue.arn, this.dlq.arn],
            },
            {
              Effect: 'Allow',
              // Also authorizes SendMessageBatch for the durable outbox.
              Action: ['sqs:SendMessage'],
              Resource: [this.queue.arn],
            },
            {
              Effect: 'Allow',
              Action: ['sqs:SendMessage'],
              Resource: [notificationIngressQueueArn],
            },
          ],
        },
        tags,
      },
      { parent: this }
    );
  }
}
