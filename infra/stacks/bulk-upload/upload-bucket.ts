import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { createBucketV2 } from '../../packages/resources/src/resources/bucket';
import { stack } from '../../packages/shared';

const isLocal = stack === 'local';

interface BulkUploadBucketArgs {
  cloudStorageServiceRoleArn?: pulumi.Output<string> | string;
  tags: { [key: string]: string };
}

export class BulkUploadBucket extends pulumi.ComponentResource {
  bucket: aws.s3.BucketV2;

  constructor(
    name: string,
    args: BulkUploadBucketArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:BulkUploadBucket', name, {}, opts);
    const { cloudStorageServiceRoleArn, tags } = args;

    if (!isLocal && cloudStorageServiceRoleArn === undefined) {
      throw new Error(
        'cloudStorageServiceRoleArn must be set for non-local stacks'
      );
    } else if (isLocal && cloudStorageServiceRoleArn !== undefined) {
      throw new Error(
        'cloudStorageServiceRoleArn must not be set for local stacks'
      );
    }

    const bucketName = `bulk-upload-staging-${stack}`;

    this.bucket = createBucketV2(
      {
        id: 'bulk-upload-bucket',
        bucketName,
        transferAcceleration: false,
        lifecycleRules: [
          {
            id: 'slack-import-cleanup',
            status: 'Enabled',
            filter: { prefix: 'slack-import/' },
            expiration: { days: 14 },
          },
        ],
        // The helper owns CORS: PUT and allowedHeaders ['*'] already permit
        // If-None-Match and x-amz-checksum-sha256 without a second CORS resource.
        tags,
      },
      { parent: this }
    );

    new aws.s3.BucketPublicAccessBlock(
      'bulk-upload-bucket-public-access-block',
      {
        bucket: this.bucket.id,
        blockPublicAcls: !isLocal,
        blockPublicPolicy: !isLocal,
        ignorePublicAcls: !isLocal,
        restrictPublicBuckets: !isLocal,
      },
      { parent: this }
    );

    const bucketPolicy = pulumi.jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          // Preserve existing bulk-upload access, including the local stack.
          Effect: 'Allow',
          Principal: { AWS: cloudStorageServiceRoleArn ?? '*' },
          Action: [
            's3:GetObject',
            's3:PutObject',
            's3:GetObjectAttributes',
            's3:ListBucket',
          ],
          Resource: [this.bucket.arn, pulumi.interpolate`${this.bucket.arn}/*`],
        },
        {
          Sid: 'RequireImmutableSlackImports',
          Effect: 'Deny',
          Principal: '*',
          Action: ['s3:PutObject'],
          Resource: [pulumi.interpolate`${this.bucket.arn}/slack-import/*`],
          // Negated matching also denies a missing header. This does not
          // affect extract/ or any other existing bulk-upload keys.
          Condition: { StringNotEquals: { 's3:if-none-match': '*' } },
        },
      ],
    });

    new aws.s3.BucketPolicy(
      'bulk-upload-bucket-policy',
      {
        bucket: this.bucket.bucket,
        policy: bucketPolicy,
      },
      { parent: this }
    );

    new aws.s3.BucketObjectv2(
      'bulk-upload-extract-folder',
      {
        bucket: this.bucket.bucket,
        key: 'extract/',
      },
      { parent: this }
    );

    if (!isLocal) {
      new aws.s3.BucketNotification(
        `${bucketName}-notification`,
        {
          bucket: this.bucket.id,
          eventbridge: true,
        },
        { parent: this }
      );
    }
  }
}
