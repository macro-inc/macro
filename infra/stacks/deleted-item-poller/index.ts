import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, getSearchEventQueue, stack } from '@shared';
import { get_coparse_api_vpc } from '@vpc';
import { DeleteItemPoller } from './lambda';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'deleted-item-poller',
};

const DATABASE_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_proxy_secret_key`),
  })
  .apply((secret) => secret.secretString);

const cloudStorageServiceStack = new pulumi.StackReference(
  'cloud-storage-service',
  {
    name: `macro-inc/cloud-storage-service/${stack}`,
  }
);

const deleteDocumentQueueArn: pulumi.Output<string> = cloudStorageServiceStack
  .getOutput('deleteDocumentQueueArn')
  .apply((arn) => arn as string);

const deleteDocumentQueueName: pulumi.Output<string> = cloudStorageServiceStack
  .getOutput('deleteDocumentQueueName')
  .apply((name) => name as string);

const deleteChatQueueArn: pulumi.Output<string> = cloudStorageServiceStack
  .getOutput('deleteChatQueueArn')
  .apply((arn) => arn as string);

const deleteChatQueueName: pulumi.Output<string> = cloudStorageServiceStack
  .getOutput('deleteChatQueueName')
  .apply((name) => name as string);

const { searchEventQueueName, searchEventQueueArn } = getSearchEventQueue();

const vpc = get_coparse_api_vpc();

const deletedItemPoller = new DeleteItemPoller('deleted-item-poller', {
  queueArns: [deleteDocumentQueueArn, deleteChatQueueArn, searchEventQueueArn],
  vpc,
  envVars: {
    DATABASE_URL: pulumi.interpolate`${DATABASE_URL}`,
    DOCUMENT_DELETE_QUEUE: pulumi.interpolate`${deleteDocumentQueueName}`,
    CHAT_DELETE_QUEUE: pulumi.interpolate`${deleteChatQueueName}`,
    SEARCH_EVENT_QUEUE: pulumi.interpolate`${searchEventQueueName}`,
    ENVIRONMENT: stack,
    RUST_LOG: 'deleted_item_poller=info',
  },
  tags,
});

export const deletedItemPollerRoleArn = deletedItemPoller.role.arn;
export const deletedItemPollerLambdaName = deletedItemPoller.lambda.name;
export const deletedItemPollerLambdaArn = deletedItemPoller.lambda.arn;
