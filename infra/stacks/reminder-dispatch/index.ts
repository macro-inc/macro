import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, getMacroNotify, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import {
  ReminderDispatchLambda,
  type ReminderDispatchLambdaEnvVars,
} from './lambda';

const tags = {
  environment: stack,
  project: 'reminder-dispatch',
};

const DATABASE_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('macro_db_proxy_secret_key'),
  })
  .apply((secret) => secret.secretString);

const { notificationIngressQueueArn } = getMacroNotify();

const vpc = get_coparse_api_vpc();

const envVars: ReminderDispatchLambdaEnvVars = {
  DATABASE_URL: pulumi.interpolate`${DATABASE_URL}`,
  ENVIRONMENT: stack,
  RUST_LOG: 'reminder_dispatch_handler=info,reminders=info,notification=info',
};

const reminderDispatch = new ReminderDispatchLambda(
  `reminder-dispatch-${stack}`,
  {
    envVars,
    queueArns: [notificationIngressQueueArn],
    vpc,
    tags,
  }
);

export const reminderDispatchRoleArn = reminderDispatch.role.arn;
export const reminderDispatchName = reminderDispatch.lambda.name;
export const reminderDispatchArn = reminderDispatch.lambda.arn;
