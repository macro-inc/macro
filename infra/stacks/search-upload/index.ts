import * as pulumi from '@pulumi/pulumi';
import { getSearchEventQueue, stack } from '@shared';
import { SearchUploadHandler } from './search-upload-lambda';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'cloud-storage-search',
};

const { searchEventQueueName, searchEventQueueArn } = getSearchEventQueue();

const BASE_NAME = 'search-upload';

const searchUploadHandler = new SearchUploadHandler(
  `${BASE_NAME}-handler-${stack}`,
  {
    envVars: {
      ENVIRONMENT: pulumi.interpolate`${stack}`,
      RUST_LOG: 'search_upload_handler=info',
      SEARCH_EVENT_QUEUE: pulumi.interpolate`${searchEventQueueName}`,
    },
    searchEventQueueArn,
    tags,
  }
);

export const searchUploadHandlerLambdaRoleArn = searchUploadHandler.role.arn;
export const searchUploadHandlerLambdaArn = searchUploadHandler.lambda.arn;
export const searchUploadHandlerLambdaName = searchUploadHandler.lambda.name;
export const searchUploadHandlerLambdaId = searchUploadHandler.lambda.id;
