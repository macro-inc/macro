import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, stack } from '@shared';
import { get_coparse_api_vpc } from '@vpc';
import {
  DocumentTextExtractorLambda,
  type DocumentTextExtractorLambdaEnvVars,
} from './document-text-extractor';

const tags = {
  environment: stack,
  tech_lead: 'teo',
  project: 'document-cognition-service',
};

const DATABASE_URL = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require(`macro_db_proxy_secret_key`),
  })
  .apply((secret) => secret.secretString);

export const coparse_api_vpc = get_coparse_api_vpc();

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const documentStorageBucketArn: pulumi.Output<string> = cloudStorageStack
  .getOutput('documentStorageBucketArn')
  .apply((arn) => arn as string);

const documentStorageBucketId: pulumi.Output<string> = cloudStorageStack
  .getOutput('documentStorageBucketId')
  .apply((id) => id as string);

const documentTextExtractorEnvVars: DocumentTextExtractorLambdaEnvVars = {
  DATABASE_URL: pulumi.interpolate`${DATABASE_URL}`,
  ENVIRONMENT: stack,
  RUST_LOG: 'document_text_extractor=trace',
  DOCUMENT_STORAGE_BUCKET: pulumi.interpolate`${documentStorageBucketId}`,
};

const documentTextExtractor = new DocumentTextExtractorLambda(
  `document-text-extractor-${stack}`,
  {
    docStorageBucketArn: documentStorageBucketArn,
    envVars: documentTextExtractorEnvVars,
    vpc: coparse_api_vpc,
    tags,
  }
);

export const documentTextExtractorLambdaRoleArn =
  documentTextExtractor.role.arn;
export const documentTextExtractorLambdaName =
  documentTextExtractor.lambda.name;
export const documentTextExtractorLambdaId = documentTextExtractor.lambda.id;
export const documentTextExtractorLambdaArn = documentTextExtractor.lambda.arn;

export const documentTextExtractorLambdaQueueArn =
  documentTextExtractor.queue.arn;

export const documentTextExtractorLambdaQueueName =
  documentTextExtractor.queue.name;
