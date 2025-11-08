import * as pulumi from '@pulumi/pulumi';
import { stack } from '@shared';

export function getSearchEventQueue(): {
  searchEventQueueName: pulumi.Output<string>;
  searchEventQueueArn: pulumi.Output<string>;
} {
  const searchServiceStack = new pulumi.StackReference(
    'search-event-queue-stack',
    {
      name: `macro-inc/search-event-queue/${stack}`,
    }
  );

  const searchEventQueueArn: pulumi.Output<string> = searchServiceStack
    .getOutput('searchEventQueueArn')
    .apply((arn) => arn as string);

  const searchEventQueueName: pulumi.Output<string> = searchServiceStack
    .getOutput('searchEventQueueName')
    .apply((arn) => arn as string);

  return {
    searchEventQueueName,
    searchEventQueueArn,
  };
}
