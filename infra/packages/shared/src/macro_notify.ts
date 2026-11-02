import * as pulumi from '@pulumi/pulumi';
import { stack } from '../../shared';

export function getMacroNotify(): {
  notificationIngressQueueName: pulumi.Output<string>;
  notificationIngressQueueArn: pulumi.Output<string>;
  notificationApnsVoipPlatformArn: pulumi.Output<string>;
  notificationFcmPlatformArn: pulumi.Output<string>;
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

  // Read from the long-deployed platform list rather than a new output: stacks
  // deploy in parallel, so a consumer could run before the new output exists.
  const notificationFcmPlatformArn: pulumi.Output<string> =
    notificationServiceStack
      .requireOutput('notificationSnsPlatformArns')
      .apply((arns) => {
        const fcmArn = (arns as string[]).find((arn) =>
          arn.includes(':app/GCM/')
        );
        if (!fcmArn) {
          throw new Error('notification-service exports no FCM platform');
        }
        return fcmArn;
      });

  return {
    notificationIngressQueueName,
    notificationIngressQueueArn,
    notificationApnsVoipPlatformArn,
    notificationFcmPlatformArn,
  };
}
