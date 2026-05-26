import * as pulumi from '@pulumi/pulumi';
import { stack } from '../../shared';

/**
 * Returns the SQS queue the email service's backfill worker consumes from.
 * Used by other services (e.g. authentication-service) that need to enqueue
 * backfill operations — currently the `PopulateCrmForUser` job that the
 * teams hex crate publishes after a successful `join_team`.
 */
export function getBackfillQueue(): {
  backfillQueueName: pulumi.Output<string>;
  backfillQueueArn: pulumi.Output<string>;
} {
  const emailServiceStack = new pulumi.StackReference('backfill-queue-stack', {
    name: `macro-inc/email-service/${stack}`,
  });

  const backfillQueueArn: pulumi.Output<string> = emailServiceStack
    .getOutput('backfillQueueArn')
    .apply((arn) => arn as string);

  const backfillQueueName: pulumi.Output<string> = emailServiceStack
    .getOutput('backfillQueueName')
    .apply((name) => name as string);

  return {
    backfillQueueName,
    backfillQueueArn,
  };
}
