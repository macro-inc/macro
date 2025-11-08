import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, stack } from '@shared';
import { get_coparse_api_vpc } from '@vpc';
import {
  EmailSuppressionLambda,
  type EmailSuppressionLambdaEnvVars,
} from './email-suppression';

let emailSuppression: EmailSuppressionLambda | undefined;
if (stack === 'prod') {
  const tags = {
    environment: stack,
    tech_lead: 'hutch',
    project: 'email-suppression',
  };

  const DATABASE_URL = aws.secretsmanager
    .getSecretVersionOutput({
      secretId: config.require(`macro_db_proxy_secret_key`),
    })
    .apply((secret) => secret.secretString);

  const bouncArn = config.require('bounc_arn');
  const complaintArn = config.require('complaint_arn');

  const coparse_api_vpc = get_coparse_api_vpc();

  const emailSuppressionEnvVars: EmailSuppressionLambdaEnvVars = {
    DATABASE_URL: pulumi.interpolate`${DATABASE_URL}`,
    ENVIRONMENT: stack,
    RUST_LOG: 'email_suppression_handler=trace',
  };

  emailSuppression = new EmailSuppressionLambda(`email-suppression-${stack}`, {
    envVars: emailSuppressionEnvVars,
    vpc: coparse_api_vpc,
    tags,
  });

  // Add these lines after creating your emailSuppression Lambda
  new aws.sns.TopicSubscription(`bounce-subscription-${stack}`, {
    topic: bouncArn,
    protocol: 'lambda',
    endpoint: emailSuppression.lambda.arn,
  });

  new aws.sns.TopicSubscription(`complaint-subscription-${stack}`, {
    topic: complaintArn,
    protocol: 'lambda',
    endpoint: emailSuppression.lambda.arn,
  });

  new aws.lambda.Permission(`bounce-permission-${stack}`, {
    function: emailSuppression.lambda.name,
    action: 'lambda:InvokeFunction',
    principal: 'sns.amazonaws.com',
    sourceArn: bouncArn,
  });

  new aws.lambda.Permission(`complaint-permission-${stack}`, {
    function: emailSuppression.lambda.name,
    action: 'lambda:InvokeFunction',
    principal: 'sns.amazonaws.com',
    sourceArn: complaintArn,
  });
}

export const emailSuppressionLambdaRoleArn = emailSuppression?.role.arn;
export const emailSuppressionLambdaName = emailSuppression?.lambda.name;
export const emailSuppressionLambdaId = emailSuppression?.lambda.id;
export const emailSuppressionLambdaArn = emailSuppression?.lambda.arn;
