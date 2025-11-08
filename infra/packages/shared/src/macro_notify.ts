import * as pulumi from '@pulumi/pulumi';
import { stack } from '@shared';

export function getMacroNotify(): {
  notificationQueueName: pulumi.Output<string>;
  notificationQueueArn: pulumi.Output<string>;
} {
  const notificationServiceStack = new pulumi.StackReference(
    'notification-service-stack',
    {
      name: `macro-inc/notification-service/${stack}`,
    }
  );

  const notificationQueueArn: pulumi.Output<string> = notificationServiceStack
    .getOutput('notificationQueueArn')
    .apply((arn) => arn as string);

  const notificationQueueName: pulumi.Output<string> = notificationServiceStack
    .getOutput('notificationQueueName')
    .apply((arn) => arn as string);

  return {
    notificationQueueName,
    notificationQueueArn,
  };
}
