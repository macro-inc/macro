import * as pulumi from '@pulumi/pulumi';
import { stack } from '../../shared';

export function getLinkManagerQueue(): {
  linkManagerQueueName: pulumi.Output<string>;
  linkManagerQueueArn: pulumi.Output<string>;
} {
  const emailServiceStack = new pulumi.StackReference(
    'link-manager-queue-stack',
    {
      name: `macro-inc/email-service/${stack}`,
    }
  );

  const linkManagerQueueArn: pulumi.Output<string> = emailServiceStack
    .getOutput('linkManagerQueueArn')
    .apply((arn) => arn as string);

  const linkManagerQueueName: pulumi.Output<string> = emailServiceStack
    .getOutput('linkManagerQueueName')
    .apply((name) => name as string);

  return {
    linkManagerQueueName,
    linkManagerQueueArn,
  };
}
