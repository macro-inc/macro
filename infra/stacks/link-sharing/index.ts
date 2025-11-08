import * as pulumi from '@pulumi/pulumi';
import { stack } from '@shared';
import {
  attachPolicyToBucket,
  getStorageBucketFromName,
} from './file-storage-bucket';
import { getCloudfrontDistribution } from './s3-cloudfront-distribution';

// To re-use this secret name after a destroy, you will need to delete the secret without recovery to prevent conflict:
// aws secretsmanager delete-secret --secret-id ${CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME} --force-delete-without-recovery
const CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME = `linksharing-private-key-${stack}`;

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const cloudStorageServiceStack = new pulumi.StackReference(
  'cloud-storage-service',
  {
    name: `macro-inc/cloud-storage-service/${stack}`,
  }
);

const shaCleanupStack = new pulumi.StackReference('cloud-storage-sha-cleanup', {
  name: `macro-inc/cloud-storage-sha-cleanup/${stack}`,
});

const documentProcessingStack = new pulumi.StackReference(
  'document-processing-stack',
  {
    name: `macro-inc/document-processing/${stack}`,
  }
);

const documentTextExtractorStack = new pulumi.StackReference(
  'document-text-extractor-stack',
  {
    name: `macro-inc/document-text-extractor/${stack}`,
  }
);

const searchProcessingStack = new pulumi.StackReference(
  'search-processing-stack',
  {
    name: `macro-inc/search-processing-service/${stack}`,
  }
);

const bulkUploadStack = new pulumi.StackReference('bulk-upload-stack', {
  name: `macro-inc/bulk-upload/${stack}`,
});

const deleteDocumentWorkerStack = new pulumi.StackReference(
  'delete-document-worker-stack',
  {
    name: `macro-inc/delete-document-worker/${stack}`,
  }
);

export const searchProcessingServiceRoleArn: pulumi.Output<string> =
  searchProcessingStack
    .getOutput('searchProcessingServiceRoleArn')
    .apply((arn) => arn as string);

export const fileStorageBucketName: pulumi.Output<string> = cloudStorageStack
  .getOutput('documentStorageBucketName')
  .apply((bucketName) => bucketName as string);
const fileStorageBucket = getStorageBucketFromName(fileStorageBucketName);

const s3CloudfrontDistribution = getCloudfrontDistribution({
  bucket: fileStorageBucket,
  privateKeySecretName: CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME,
});
export const s3CloudfrontDistributionId =
  s3CloudfrontDistribution.distribution.id;
export const cloudfrontDistributionUrl = s3CloudfrontDistribution.domain;
export const cloudfrontDistributionPublicKeyId =
  s3CloudfrontDistribution.publicKey.id;

const documentStorageBucketReplicationRoleArn: pulumi.Output<string> =
  cloudStorageStack
    .getOutput('documentStorageBucketReplicationRoleArn')
    .apply(
      (documentStorageBucketReplicationRoleArn) =>
        documentStorageBucketReplicationRoleArn as string
    );

const docStorageRoleArn: pulumi.Output<string> = cloudStorageServiceStack
  .getOutput('cloudStorageServiceRoleArn')
  .apply((arn) => arn as string);

const docxUnzipRoleArn: pulumi.Output<string> = cloudStorageServiceStack
  .getOutput('docxUnzipHandlerRoleArn')
  .apply((arn) => arn as string);

const deleteDocumentWorkerRoleArn: pulumi.Output<string> =
  deleteDocumentWorkerStack
    .getOutput('deleteDocumentWorkerRoleArn')
    .apply((arn) => arn as string);

const shaCleanupWorkerArn: pulumi.Output<string> = shaCleanupStack
  .getOutput('shaCleanupWorkerRoleArn')
  .apply((shaCleanupWorkerArn) => shaCleanupWorkerArn as string);

const documentProcessingServiceRoleArn: pulumi.Output<string> =
  documentProcessingStack
    .getOutput('documentProcessingServiceRoleArn')
    .apply(
      (documentProcessingServiceRoleArn) =>
        documentProcessingServiceRoleArn as string
    );

const pdfPreprocessLambdaRoleArn: pulumi.Output<string> =
  documentProcessingStack
    .getOutput('pdfPreprocessLambdaRoleArn')
    .apply(
      (pdfPreprocessLambdaRoleArn) => pdfPreprocessLambdaRoleArn as string
    );

const documentTextExtractorArn: pulumi.Output<string> =
  documentTextExtractorStack
    .getOutput('documentTextExtractorLambdaRoleArn')
    .apply((arn) => arn as string);

export const bulkUploadLambdaRoleArn: pulumi.Output<string> = bulkUploadStack
  .getOutput('uploadExtractHandlerLambdaRoleArn')
  .apply((arn) => arn as string);

const convertServiceStack = new pulumi.StackReference('convert-service-stack', {
  name: `macro-inc/convert-service/${stack}`,
});

const convertServiceRoleArn: pulumi.Output<string> = convertServiceStack
  .getOutput('convertServiceRoleArn')
  .apply((arn) => arn as string);

export const bucketPolicy = attachPolicyToBucket({
  cloudfrontDistributionArn: s3CloudfrontDistribution.distribution.arn,
  bucket: fileStorageBucket,
  docStorageRoleArn,
  docxUnzipRoleArn,
  shaCleanupWorkerArn,
  documentProcessingServiceRoleArn,
  pdfPreprocessLambdaRoleArn,
  documentStorageBucketReplicationRoleArn,
  deleteDocumentWorkerRoleArn,
  documentTextExtractorArn,
  searchProcessingServiceRoleArn,
  bulkUploadLambdaRoleArn,
  convertServiceRoleArn,
});
