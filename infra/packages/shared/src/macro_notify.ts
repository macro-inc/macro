import * as pulumi from '@pulumi/pulumi';
import { stack } from '../../shared';

export function getMacroNotify(): {
  notificationIngressQueueName: pulumi.Output<string>;
  notificationIngressQueueArn: pulumi.Output<string>;
  notificationApnsVoipPlatformArn: pulumi.Output<string>;
} {
  const notificationServiceStack = new pulumi.StackReference(
    'notification-service-stack',
    {
      name: `macro-inc/notification-service/${stack}`,
    }
  );

  const notificationIngressQueueArn: pulumi.Output<string> =
    notificationServiceStack
      .getOutput('notificationIngressQueueArn')
      .apply((arn) => arn as string);

  const notificationIngressQueueName: pulumi.Output<string> =
    notificationServiceStack
      .getOutput('notificationIngressQueueName')
      .apply((name) => name as string);

  const notificationApnsVoipPlatformArn: pulumi.Output<string> =
    notificationServiceStack
      .requireOutput('notificationApnsVoipPlatformArn')
      .apply((arn) => arn as string);

  return {
    notificationIngressQueueName,
    notificationIngressQueueArn,
    notificationApnsVoipPlatformArn,
  };
}
