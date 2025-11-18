import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { DynamoDBTable } from '@resources';
import { config, stack } from '@shared';
import { BulkUploadBucket } from './upload-bucket';
import { UploadExtractorLambdaHandler } from './upload-extractor-lambda-handler';
import { UploadExtractorLambdaTrigger } from './upload-extractor-lambda-trigger';
import { BulkUploadQueue } from './upload-queue';

const tags = {
  environment: stack,
  tech_lead: 'gab',
  project: 'bulk-upload',
};

let cloudStorageServiceStack: pulumi.StackReference | undefined;
if (stack !== 'local') {
  cloudStorageServiceStack = new pulumi.StackReference(
    'cloud-storage-service',
    {
      name: `macro-inc/cloud-storage-service/${stack}`,
    }
  );
}

const uploadTable = new DynamoDBTable('bulk-upload-table', {
  baseName: `bulk-upload`,
  staticNameOverride:
    stack === 'local' ? 'bulk-upload-test' : `bulk-upload-${stack}`,
  attributes: [
    { name: 'PK', type: 'S' },
    { name: 'SK', type: 'S' },
  ] as aws.types.input.dynamodb.TableAttribute[],
  hashKey: 'PK',
  rangeKey: 'SK',
  globalSecondaryIndexes: [
    {
      name: 'DocumentPkIndex',
      hashKey: 'SK',
      projectionType: 'ALL',
    },
  ],
});
export const dynamoTableName = uploadTable.table.name;

export let cloudStorageServiceRoleName: pulumi.Output<string>;
if (stack !== 'local') {
  cloudStorageServiceRoleName = cloudStorageServiceStack!
    .getOutput('cloudStorageServiceRoleArn')
    .apply((arn) => arn.split('/')[1] as string);

  const bulkUploadTablePolicy = new aws.iam.Policy(
    `bulk-upload-table-policy-${stack}`,
    {
      description:
        'Policy allowing cloud-storage-service to access bulk upload table',
      policy: uploadTable.table.arn.apply((tableArn) =>
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['dynamodb:*'],
              Resource: [
                tableArn,
                `${tableArn}/index/*`, // Include GSIs
              ],
            },
          ],
        })
      ),
    }
  );

  new aws.iam.RolePolicyAttachment(
    `bulk-upload-table-policy-attachment-${stack}`,
    {
      role: cloudStorageServiceRoleName,
      policyArn: bulkUploadTablePolicy.arn,
    }
  );
}

const bulkUploadQueue = new BulkUploadQueue('bulk-upload-queue', {
  tags,
});

let bulkUploadBucket: BulkUploadBucket;
if (stack !== 'local') {
  const cloudStorageServiceRoleArn = cloudStorageServiceStack!
    .getOutput('cloudStorageServiceRoleArn')
    .apply((arn) => arn as string);
  bulkUploadBucket = new BulkUploadBucket('bulk-upload-bucket', {
    tags,
    cloudStorageServiceRoleArn: cloudStorageServiceRoleArn,
  });
} else {
  bulkUploadBucket = new BulkUploadBucket('bulk-upload-bucket', {
    tags,
  });
}

export let uploadExtractTriggerLambdaName: pulumi.Output<string>;
export let uploadExtractTriggerLambdaEnv: pulumi.Output<
  aws.types.output.lambda.FunctionEnvironment | undefined
>;
export let uploadExtractHandlerLambdaName: pulumi.Output<string>;
export let uploadExtractHandlerLambdaRoleArn: pulumi.Output<string>;
export let uploadExtractHandlerLambdaEnv: pulumi.Output<
  aws.types.output.lambda.FunctionEnvironment | undefined
>;
export let cloudStorageServiceUrl: pulumi.Output<string>;

// use the invoke the lambdas locally with a local dss server for testing
if (stack !== 'local') {
  const documentStorageServiceAuthKeyName = config.get(
    `document_storage_service_auth_key`
  );
  if (!documentStorageServiceAuthKeyName) {
    throw new Error('document_storage_service_auth_key must be set');
  }

  const connectionGatewayStack = new pulumi.StackReference(
    'connection-gateway-stack',
    {
      name: `macro-inc/connection-gateway/${stack}`,
    }
  );
  const connectionGatewayUrl = connectionGatewayStack
    .getOutput('connectionGatewayUrl')
    .apply((arn) => arn as string);

  const documentStorageServiceAuthKey = aws.secretsmanager
    .getSecretVersionOutput({
      secretId: documentStorageServiceAuthKeyName,
    })
    .apply((secret) => secret.secretString);

  cloudStorageServiceUrl = cloudStorageServiceStack!
    .getOutput('cloudStorageServiceUrl')
    .apply((url) => url as string);

  const uploadExtractorLambdaTrigger = new UploadExtractorLambdaTrigger(
    `upload-extractor-lambda-trigger-${stack}`,
    {
      envVars: {
        DYNAMODB_TABLE: pulumi.interpolate`${dynamoTableName}`,
        UPLOAD_EXTRACTOR_QUEUE: pulumi.interpolate`${bulkUploadQueue.queue.name}`,
        ENVIRONMENT: stack,
        RUST_LOG: 'upload_extractor_lambda_trigger=trace',
      },
      uploadExtractorQueueArn: bulkUploadQueue.queue.arn,
      uploadBucketName: pulumi.interpolate`${bulkUploadBucket.bucket.bucket}`,
      tags,
    }
  );

  const uploadExtractorLambdaHandler = new UploadExtractorLambdaHandler(
    `upload-extractor-lambda-handler-${stack}`,
    {
      envVars: {
        DYNAMODB_TABLE: pulumi.interpolate`${dynamoTableName}`,
        UPLOAD_BUCKET_NAME: pulumi.interpolate`${bulkUploadBucket.bucket.bucket}`,
        INTERNAL_API_SECRET_KEY: pulumi.interpolate`${documentStorageServiceAuthKey}`,
        DSS_URL: pulumi.interpolate`${cloudStorageServiceUrl}`,
        CONNECTION_GATEWAY_URL: pulumi.interpolate`${connectionGatewayUrl}`,
        ENVIRONMENT: stack,
        RUST_LOG: 'upload_extractor_lambda_handler=trace',
      },
      uploadExtractorQueueArn: bulkUploadQueue.queue.arn,
      uploadBucketArn: pulumi.interpolate`${bulkUploadBucket.bucket.arn}`,
      tags,
    }
  );

  uploadExtractTriggerLambdaName = uploadExtractorLambdaTrigger.lambda.name;
  uploadExtractTriggerLambdaEnv =
    uploadExtractorLambdaTrigger.lambda.environment;

  uploadExtractHandlerLambdaName = uploadExtractorLambdaHandler.lambda.name;
  uploadExtractHandlerLambdaRoleArn = uploadExtractorLambdaHandler.role.arn;
  uploadExtractHandlerLambdaEnv =
    uploadExtractorLambdaHandler.lambda.environment;
}

export const bulkUploadQueueName = bulkUploadQueue.queue.name;
export const bulkUploadBucketName = bulkUploadBucket.bucket.bucket;
