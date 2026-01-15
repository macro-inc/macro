import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Queue } from '../../packages/resources';
import { config, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { EmailSfsDeleteHandler } from './sfs_delete_lambda';

const tags = {
  environment: stack,
  tech_lead: 'evan',
  project: 'email-service',
};

export const coparse_api_vpc = get_coparse_api_vpc();

const MACRO_DB_URL_SECRET_NAME = config.require(`macro_db_secret_key`);
const MACRO_DB_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: MACRO_DB_URL_SECRET_NAME,
  })
  .apply((secret) => secret.secretString);

const sfs_delete_queue = new Queue('email-sfs-delete', {
  tags,
  maxReceiveCount: 5,
  visibilityTimeoutSeconds: 60,
});

export const sfsDeleteQueueArn = pulumi.interpolate`${sfs_delete_queue.queue.arn}`;
export const sfsDeleteQueueName = pulumi.interpolate`${sfs_delete_queue.queue.name}`;

const emailSfsDeleteHandler = new EmailSfsDeleteHandler(
  'email-sfs-delete-handler',
  {
    queueArns: [sfsDeleteQueueArn],
    vpc: coparse_api_vpc,
    envVars: {
      DATABASE_URL: pulumi.interpolate`${MACRO_DB_URL}`,
      ENVIRONMENT: stack,
      RUST_LOG: 'email_sfs_delete_handler=info',
      SFS_DELETE_QUEUE: pulumi.interpolate`${sfsDeleteQueueName}`,
    },
    tags,
  }
);

export const emailSfsDeleteHandlerRoleArn = emailSfsDeleteHandler.role.arn;
export const emailSfsDeleteHandlerLambdaName =
  emailSfsDeleteHandler.lambda.name;
export const emailSfsDeleteHandlerLambdaArn = emailSfsDeleteHandler.lambda.arn;
