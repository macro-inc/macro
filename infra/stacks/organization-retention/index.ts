import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, stack } from '@shared';
import { get_coparse_api_vpc } from '@vpc';
import { OrganizationRetentionHandler } from './organization-retention-handler';
import { OrganizationRetentionTrigger } from './organization-retention-trigger';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'organization-retention',
};

const coparse_api_vpc = get_coparse_api_vpc();

const cloudStorageServiceStack = new pulumi.StackReference(
  'cloud-storage-service',
  {
    name: `macro-inc/cloud-storage-service/${stack}`,
  }
);

const deleteDocumentQueueArn: pulumi.Output<string> = cloudStorageServiceStack
  .getOutput('deleteDocumentQueueArn')
  .apply((arn) => arn as string);

export const deleteDocumentQueueName: pulumi.Output<string> =
  cloudStorageServiceStack
    .getOutput('deleteDocumentQueueName')
    .apply((name) => name as string);

export const deleteChatQueueArn: pulumi.Output<string> =
  cloudStorageServiceStack
    .getOutput('deleteChatQueueArn')
    .apply((arn) => arn as string);

export const deleteChatQueueName: pulumi.Output<string> =
  cloudStorageServiceStack
    .getOutput('deleteChatQueueName')
    .apply((name) => name as string);

const DATABASE_URL_PROXY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_proxy_secret_key`),
  })
  .apply((secret) => secret.secretString);

const organizationRetentionHandler = new OrganizationRetentionHandler(
  `organization-retention-handler-${stack}`,
  {
    envVars: {
      DATABASE_URL: pulumi.interpolate`${DATABASE_URL_PROXY}`,
      ENVIRONMENT: stack,
      RUST_LOG: 'organization_retention_handler=trace',
      DOCUMENT_DELETE_QUEUE: deleteDocumentQueueName,
      CHAT_DELETE_QUEUE: deleteChatQueueName,
    },
    deleteDocumentQueueArn,
    deleteChatQueueArn,
    vpc: coparse_api_vpc,
    tags,
  }
);

export const organizationRetentionHandlerRoleArn =
  organizationRetentionHandler.role.arn;
export const organizationRetentionHandlerLambdaName =
  organizationRetentionHandler.lambda.name;
export const organizationRetentionQueueArn =
  organizationRetentionHandler.queue.arn;
export const organizationRetentionQueueName =
  organizationRetentionHandler.queue.name;

const organizationRetentionTrigger = new OrganizationRetentionTrigger(
  `organization-retention-trigger-${stack}`,
  {
    envVars: {
      ORGANIZATION_RETENTION_QUEUE: pulumi.interpolate`${organizationRetentionQueueName}`,
      DATABASE_URL: pulumi.interpolate`${DATABASE_URL_PROXY}`,
      ENVIRONMENT: stack,
      RUST_LOG: 'organization_retention_trigger=trace,sqs_client=trace',
    },
    organizationRetentionQueueArn,
    vpc: coparse_api_vpc,
    tags,
  }
);

export const organizationRetentionTriggerRoleArn =
  organizationRetentionTrigger.role.arn;
export const organizationRetentionTriggerLambdaName =
  organizationRetentionTrigger.lambda.name;
