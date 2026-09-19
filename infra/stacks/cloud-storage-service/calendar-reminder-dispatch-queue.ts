import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Queue } from '../../packages/resources';
import { stack } from '../../packages/shared';

const BASE_NAME = 'calendar-reminder-dispatch';

/** The literal payload the rule publishes. Must match `CalendarReminderDispatchOperation::Sweep`. */
const SWEEP_PAYLOAD = JSON.stringify({ operation: 'sweep' });

type Args = {
  tags: { [key: string]: string };
};

/**
 * The queue calendar event reminder dispatch runs on, and the schedule that
 * drives it.
 *
 * Every minute EventBridge puts a static sweep payload on the queue. A
 * cloud-storage-service task picks it up, finds every calendar reminder
 * firing that has come due, and fans one message back onto this same queue
 * per firing — which the whole pool then delivers in parallel. One queue
 * carries both kinds of message; the worker tells them apart by their
 * `operation`.
 *
 * There is no consumer resource here: the workers are the service's own
 * tasks, which reach the queue through the `sqs:*` grant in its role.
 */
export class CalendarReminderDispatchQueue extends pulumi.ComponentResource {
  queue: aws.sqs.Queue;
  dlq: aws.sqs.Queue;
  rule: aws.cloudwatch.EventRule;

  constructor(
    name: string,
    args: Args,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:CalendarReminderDispatchQueue', name, {}, opts);
    const { tags } = args;

    const queue = new Queue(
      BASE_NAME,
      {
        tags,
        maxReceiveCount: 5,
        // A delivery is a handful of round trips, and a sweep is one query
        // plus a batch send per ten firings. Generous enough that neither is
        // racing the clock, short enough that a killed task's message comes
        // back fast.
        visibilityTimeoutSeconds: 60,
      },
      { parent: this }
    );

    this.queue = queue.queue;
    this.dlq = queue.dlq;

    this.rule = new aws.cloudwatch.EventRule(
      `${BASE_NAME}-rule`,
      {
        name: `${BASE_NAME}-rule-${stack}`,
        scheduleExpression: 'rate(1 minute)',
        tags,
      },
      { parent: this }
    );

    new aws.cloudwatch.EventTarget(
      `${BASE_NAME}-minutely-target`,
      {
        rule: this.rule.name,
        arn: this.queue.arn,
        input: SWEEP_PAYLOAD,
      },
      { parent: this }
    );

    new aws.sqs.QueuePolicy(
      `${BASE_NAME}-queue-policy`,
      {
        queueUrl: this.queue.url,
        policy: pulumi
          .all([this.queue.arn, this.rule.arn])
          .apply(([queueArn, ruleArn]) =>
            JSON.stringify({
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Principal: { Service: 'events.amazonaws.com' },
                  Action: 'sqs:SendMessage',
                  Resource: queueArn,
                  // Scoped to this rule so nothing else in EventBridge can
                  // trigger a sweep.
                  Condition: { ArnEquals: { 'aws:SourceArn': ruleArn } },
                },
              ],
            })
          ),
      },
      { parent: this }
    );
  }
}
