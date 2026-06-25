import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, getSearchEventQueue, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
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

const deleteChatQueueArn: pulumi.Output<string> = cloudStorageServiceStack
  .getOutput('deleteChatQueueArn')
  .apply((arn) => arn as string);

const { searchEventQueueArn } = getSearchEventQueue();

const vpc = get_coparse_api_vpc();

const deletedItemPoller = new DeleteItemPoller('deleted-item-poller', {
  queueArns: [deleteDocumentQueueArn, deleteChatQueueArn, searchEventQueueArn],
  vpc,
  envVars: {
    DATABASE_URL: pulumi.interpolate`${DATABASE_URL}`,
    ENVIRONMENT: stack,
    RUST_LOG: 'deleted_item_poller=info',
  },
  tags,
});

export const deletedItemPollerRoleArn = deletedItemPoller.role.arn;
export const deletedItemPollerLambdaName = deletedItemPoller.lambda.name;
export const deletedItemPollerLambdaArn = deletedItemPoller.lambda.arn;
