import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Queue } from '@resources';
import { stack } from '@shared';

type Args = {
  tags: { [key: string]: string };
};

export class PushNotificationEventHandler extends pulumi.ComponentResource {
  public pushDeliveryQueue: aws.sqs.Queue;
  public pushDeliveryTopic: aws.sns.Topic;
  public subscription: aws.sns.TopicSubscription;
  public tags: { [key: string]: string };

  constructor(
    name: string,
    { tags }: Args,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:PushNotificationEventHandler', name, {}, opts);
    this.tags = tags;

    const queue = new Queue(
      'push-delivery',
      {
        tags,
      },
      { parent: this }
    );

    this.pushDeliveryQueue = queue.queue;

    this.pushDeliveryTopic = new aws.sns.Topic(
      'topic',
      {
        name: `push-delivery-topic-${stack}`,
        displayName: `push-delivery-topic-${stack}`,
        tags,
      },
      { parent: this }
    );

    // Queue policy sucks
    new aws.sqs.QueuePolicy(
      `queue-policy-${stack}`,
      {
        queueUrl: this.pushDeliveryQueue.id,
        policy: pulumi
          .all([this.pushDeliveryQueue.arn, this.pushDeliveryTopic.arn])
          .apply(([queueArn, topicArn]) =>
            JSON.stringify({
              Version: '2012-10-17',
              Id: `${stack}-sqs-sns-policy`,
              Statement: [
                {
                  Sid: 'Allow-SNS-SendMessage',
                  Effect: 'Allow',
                  Principal: { Service: 'sns.amazonaws.com' },
                  Action: 'sqs:SendMessage',
                  Resource: queueArn,
                  Condition: {
                    ArnEquals: {
                      'aws:SourceArn': topicArn,
                    },
                  },
                },
              ],
            })
          ),
      },
      { parent: this }
    );

    this.subscription = new aws.sns.TopicSubscription(
      'subscription',
      {
        topic: this.pushDeliveryTopic.arn,
        protocol: 'sqs',
        endpoint: pulumi.interpolate`${this.pushDeliveryQueue.arn}`,
      },
      { parent: this }
    );
  }
}
