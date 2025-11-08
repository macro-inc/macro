import { JobTypeEnum } from '@macro-inc/document-processing-job-types';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { JavascriptLambda, RustLambda } from 'pulumi-shared-resources';
import { JobSubmissionTable } from './resources/job-submission-table';
import {
  CLOUDWATCH_KINESIS_STREAM_ROLE_ARN,
  DATADOG_KINESIS_FIREHOSE_STREAM_ARN,
  stack,
  standardConfig,
  tags,
} from './resources/shared';
import { WebsocketApiGateway } from './resources/websocket-api-gateway';
import { WebsocketConnectionTable } from './resources/ws-connection-table';

const websocketApiGateway = new WebsocketApiGateway();
export const api = websocketApiGateway.api;
export const apiGatewayEndpointUrl = websocketApiGateway.getEndpoint();

export const websocketConnectionTable = new WebsocketConnectionTable(
  'websocket-connection-table',
  {
    name: 'websocket-connection-table',
    attributes: [{ name: 'ConnectionId', type: 'S' }],
    hashKey: 'ConnectionId',
    billingMode: 'PAY_PER_REQUEST',
    stack,
    ttl: true,
  }
);

export const jobSubmissionTable = new JobSubmissionTable(
  'job-submission-table',
  {
    name: 'job-submission-table',
    attributes: [
      { name: 'JobId', type: 'S' },
      { name: 'DocumentIdJobType', type: 'S' },
    ],
    globalSecondaryIndexes: [
      {
        name: 'DocumentIdJobTypeIndex',
        hashKey: 'DocumentIdJobType',
        projectionType: 'ALL', // Adjust projection type as needed
      },
    ],
    hashKey: 'JobId',
    billingMode: 'PAY_PER_REQUEST',
    stack,
    ttl: true,
  }
);

export const wsPingLogGroup = new aws.cloudwatch.LogGroup(
  `ws-ping-response-handler-log-group-${stack}`,
  {
    name: `/aws/lambda/ws-ping-response-handler-${stack}`,
    retentionInDays: 7,
    tags,
  }
);

// Define the subscription filter
new aws.cloudwatch.LogSubscriptionFilter(
  `ws-ping-response-handler-log-subscription-filter`,
  {
    name: `ws-ping-response-handler-${stack}`,
    logGroup: wsPingLogGroup.name,
    destinationArn: DATADOG_KINESIS_FIREHOSE_STREAM_ARN,
    filterPattern: '{ $.* = "*" }',
    roleArn: CLOUDWATCH_KINESIS_STREAM_ROLE_ARN,
  }
);

export const { lambda: testResponseLambda, role: testResponseLambdaRole } =
  new JavascriptLambda(
    `ws-ping-response-handler-lambda-custom-resource-${stack}`,
    {
      loggingConfig: {
        logFormat: 'Text',
        logGroup: wsPingLogGroup.name,
      },
      handlerName: `ws-ping-response-handler-${stack}`,
      handlerBase: '../handlers/test-response-handler',
      handlerEntrypoint: 'index.handler',
      envVars: {
        API_GATEWAY_ENDPOINT_URL: apiGatewayEndpointUrl,
      },
      stack,
      additionalManagedPolicyArns: [
        aws.iam.ManagedPolicy.AmazonAPIGatewayInvokeFullAccess,
        aws.iam.ManagedPolicies.CloudWatchLogsFullAccess,
      ],
      registerAlarms: true,
      alarmConfig: {
        throttleThreshold: 1,
        errorThreshold: 25,
      },
      tags,
    }
  );
export const testResponseIntegration = websocketApiGateway.addIntegration({
  name: 'ws-ping-response-handler',
  lambdaInvokeArn: testResponseLambda.invokeArn,
});
export const testResponseRoute = websocketApiGateway.addRoute({
  routeKey: 'wsping',
  integration: testResponseIntegration,
});
testResponseLambda.name.apply((name) => {
  websocketApiGateway.enableInvokeLambda({
    name,
  });
});

const jobsHandlerEnvVars = {
  JOB_SUBMISSION_TABLE_NAME: jobSubmissionTable.table.name,
  API_GATEWAY_ENDPOINT_URL: apiGatewayEndpointUrl,
  WEBSOCKET_CONNECTION_TABLE_NAME: websocketConnectionTable.table.name,
  DOCUMENT_PROCESSING_SERVICE_URL:
    stack === 'prod'
      ? 'https://document-processing.macro.com/job'
      : `https://document-processing-${stack}.macro.com/job`,
  MOCK_ERROR: 'false',
  VERBOSE: stack === 'prod' ? 'true' : 'true',
  JOB_SUBMISSION_EXPIRATION_MINUTES: '1440', // 24 hours
};

const sendResponseToApiGatewayPolicy =
  websocketApiGateway.getLambdaInvokeApiGatewayPolicy();

export const jobSubmissionLogGroup = new aws.cloudwatch.LogGroup(
  `job-submissiong-handler-log-group-${stack}`,
  {
    name: `/aws/lambda/job-submission-handler-${stack}`,
    retentionInDays: 7,
    tags,
  }
);

// Define the subscription filter
new aws.cloudwatch.LogSubscriptionFilter(
  `job-submission-handler-log-subscription-filter`,
  {
    name: `job-submission-handler-${stack}`,
    logGroup: jobSubmissionLogGroup.name,
    destinationArn: DATADOG_KINESIS_FIREHOSE_STREAM_ARN,
    filterPattern: '{ $.* = "*" }',
    roleArn: CLOUDWATCH_KINESIS_STREAM_ROLE_ARN,
  }
);

export const {
  lambda: jobSubmissionHandlerLambda,
  role: jobSubmissionHandlerLambdaRole,
} = new RustLambda(`job-submission-lambda-custom-resource-${stack}`, {
  handlerName: 'job-submission-handler',
  handlerBase: '../handlers/jobs-handler',
  loggingConfig: {
    logFormat: 'Text',
    logGroup: jobSubmissionLogGroup.name,
  },
  stack,
  envVars: {
    ...jobsHandlerEnvVars,
    RUST_LOG: 'submit=trace',
  },
  privateVpc: true,
  buildCommand: 'make build-submit',
  zipLocation: '../handlers/jobs-handler/target/lambda/submit/bootstrap.zip',
  additionalManagedPolicyArns: [
    aws.iam.ManagedPolicy.AmazonDynamoDBFullAccess,
    aws.iam.ManagedPolicies.AWSLambdaVPCAccessExecutionRole,
    aws.iam.ManagedPolicies.CloudWatchLogsFullAccess,
    sendResponseToApiGatewayPolicy.arn,
  ],
  tags,
});

export const jobSubmissionIntegration = websocketApiGateway.addIntegration({
  name: 'job-submission-handler',
  lambdaInvokeArn: jobSubmissionHandlerLambda.invokeArn,
});
jobSubmissionHandlerLambda.name.apply((name) => {
  websocketApiGateway.enableInvokeLambda({
    name,
  });
});

const routeKeys: string[] = Object.values(JobTypeEnum);
for (const routeKey of routeKeys) {
  websocketApiGateway.addRoute({
    routeKey,
    integration: jobSubmissionIntegration,
  });
}

const FUSIONAUTH_JWT_SECRET_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: standardConfig.require('fusionauth_jwt_secret_key_name'),
  })
  .apply((secret) => secret.secretString);

export const jobUpdateLogGroup = new aws.cloudwatch.LogGroup(
  `job-updateg-handler-log-group-${stack}`,
  {
    name: `/aws/lambda/job-update-handler-${stack}`,
    retentionInDays: 7,
    tags,
  }
);

// Define the subscription filter
new aws.cloudwatch.LogSubscriptionFilter(
  `job-update-handler-log-subscription-filter`,
  {
    name: `job-update-handler-${stack}`,
    logGroup: jobUpdateLogGroup.name,
    destinationArn: DATADOG_KINESIS_FIREHOSE_STREAM_ARN,
    filterPattern: '{ $.* = "*" }',
    roleArn: CLOUDWATCH_KINESIS_STREAM_ROLE_ARN,
  }
);

export const {
  lambda: jobUpdateHandlerLambda,
  role: jobUpdateHandlerLambdaRole,
} = new RustLambda(`job-update-lambda-custom-resource-${stack}`, {
  handlerName: 'job-update-handler',
  handlerBase: '../handlers/jobs-handler',
  loggingConfig: {
    logFormat: 'Text',
    logGroup: jobUpdateLogGroup.name,
  },
  stack,
  envVars: {
    ...jobsHandlerEnvVars,
    RUST_LOG: 'update=info',
  },
  buildCommand: 'make build-update',
  zipLocation: '../handlers/jobs-handler/target/lambda/update/bootstrap.zip',
  additionalManagedPolicyArns: [
    aws.iam.ManagedPolicy.AmazonDynamoDBFullAccess,
    aws.iam.ManagedPolicies.CloudWatchLogsFullAccess,
    sendResponseToApiGatewayPolicy.arn, // this lets the lambda invoke the API Gateway to send messages to the client
  ],
  tags,
});

export const wsApiGatewayAuthorizerLogGroup = new aws.cloudwatch.LogGroup(
  `ws-api-gateway-authorizer-lambda-log-group-${stack}`,
  {
    name: `/aws/lambda/ws-api-gateway-authorizer-lambda-${stack}`,
    retentionInDays: 7,
    tags,
  }
);

// Define the subscription filter
new aws.cloudwatch.LogSubscriptionFilter(
  `ws-api-gateway-authorizer-lambda-log-subscription-filter`,
  {
    name: `ws-api-gateway-authorizer-lambda-${stack}`,
    logGroup: wsApiGatewayAuthorizerLogGroup.name,
    destinationArn: DATADOG_KINESIS_FIREHOSE_STREAM_ARN,
    filterPattern: '{ $.* = "*" }',
    roleArn: CLOUDWATCH_KINESIS_STREAM_ROLE_ARN,
  }
);

const { lambda: authorizerLambda } = new JavascriptLambda(
  `ws-api-gateway-authorizer-lambda-${stack}`,
  {
    loggingConfig: {
      logFormat: 'Text',
      logGroup: wsApiGatewayAuthorizerLogGroup.name,
    },
    handlerName: `ws-api-gateway-authorizer-lambda-${stack}`,
    baseName: `ws-api-gateway-authorizer-lambda-${stack}`,
    handlerBase: '../handlers/authorization-handler',
    handlerEntrypoint: 'index.handler',
    zipLocation: '../handlers/authorization-handler/dist/index.zip',
    additionalManagedPolicyArns: [
      aws.iam.ManagedPolicies.CloudWatchLogsFullAccess,
    ],
    stack,
    envVars: {
      FUSIONAUTH_JWT_SECRET_KEY: pulumi.interpolate`${FUSIONAUTH_JWT_SECRET_KEY}`,
      ENVIRONMENT: stack,
    },
    registerAlarms: true,
    alarmConfig: {
      throttleThreshold: 1,
      errorThreshold: 25,
    },
    tags,
  }
);

export const wsConnectInitLambdaLogGroup = new aws.cloudwatch.LogGroup(
  `ws-connect-init-lambda-log-group-${stack}`,
  {
    name: `/aws/lambda/ws-connect-init-lambda-${stack}`,
    retentionInDays: 7,
    tags,
  }
);

// Define the subscription filter
new aws.cloudwatch.LogSubscriptionFilter(
  `ws-connect-init-lambda-log-subscription-filter`,
  {
    name: `ws-connect-init-lambda-${stack}`,
    logGroup: wsConnectInitLambdaLogGroup.name,
    destinationArn: DATADOG_KINESIS_FIREHOSE_STREAM_ARN,
    filterPattern: '{ $.* = "*" }',
    roleArn: CLOUDWATCH_KINESIS_STREAM_ROLE_ARN,
  }
);

export const { lambda: connectInitLambda, role: connectInitLambdaRole } =
  new RustLambda(`ws-connect-init-lambda-custom-resource-${stack}`, {
    loggingConfig: {
      logFormat: 'Text',
      logGroup: wsConnectInitLambdaLogGroup.name,
    },
    handlerName: 'ws-connection-init-handler',
    handlerBase: '../handlers/connect-init-handler',
    stack,
    envVars: {
      VERBOSE: 'true',
      RUST_LOG: 'connect_init_handler=info',
      WEBSOCKET_CONNECTION_TABLE_NAME: websocketConnectionTable.table.name,
      WEBSOCKET_CONNECTION_EXPIRATION_MINUTES: '1440', // 24 hours
    },
    buildCommand: 'make build',
    zipLocation:
      '../handlers/connect-init-handler/target/lambda/connect-init-handler/bootstrap.zip',
    additionalManagedPolicyArns: [
      sendResponseToApiGatewayPolicy.arn, // this lets the lambda invoke the API Gateway to send messages to the client
      aws.iam.ManagedPolicies.AWSLambdaVPCAccessExecutionRole,
      aws.iam.ManagedPolicies.CloudWatchLogsFullAccess,
      aws.iam.ManagedPolicy.AmazonDynamoDBFullAccess,
    ],
    registerAlarms: true,
    alarmConfig: {
      throttleThreshold: 1,
      errorThreshold: 25,
    },
    tags,
  });
connectInitLambda.name.apply((name) => {
  websocketApiGateway.enableInvokeLambda({
    name,
  });
});

const connectInitIntegration = websocketApiGateway.addIntegration({
  name: 'connect-init-handler',
  lambdaInvokeArn: connectInitLambda.invokeArn,
});

websocketApiGateway.addCustomAuthorizer({
  name: authorizerLambda.name,
  invokeArn: authorizerLambda.invokeArn,
});

export const connectRoute = websocketApiGateway.addConnectRoute({
  withAuthorizer: true,
  integration: connectInitIntegration,
});

export const stage = websocketApiGateway.addStage();
export const deployment = websocketApiGateway.deployment;
