import * as pulumi from '@pulumi/pulumi';
import { stack } from '../../shared';

export function getMacroNotify(): {
  notificationQueueName: pulumi.Output<string>;
  notificationQueueArn: pulumi.Output<string>;
} {
  const cloudStorageServiceStack = new pulumi.StackReference(
    'cloud-storage-service-notify-stack',
    {
      name: `macro-inc/cloud-storage-service/${stack}`,
    }
  );

  const notificationQueueArn: pulumi.Output<string> = cloudStorageServiceStack
    .getOutput('notificationQueueArn')
    .apply((arn) => arn as string);

  const notificationQueueName: pulumi.Output<string> = cloudStorageServiceStack
    .getOutput('notificationQueueName')
    .apply((arn) => arn as string);

  return {
    notificationQueueName,
    notificationQueueArn,
  };
}
