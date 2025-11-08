import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { createBucketV2 } from '@resources/resources/bucket';
import { stack } from '@shared';

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

    // Only grant access to the document storage service role if it exists
    const allowAccessPolicy = pulumi
      .all([this.bucket.arn, cloudStorageServiceRoleArn])
      .apply(([bucketArn, roleArn]) => {
        const principals = roleArn
          ? [{ type: 'AWS', identifiers: [roleArn] }]
          : [{ type: 'AWS', identifiers: ['*'] }];

        return aws.iam.getPolicyDocumentOutput({
          statements: [
            {
              principals,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:GetObjectAttributes',
                's3:ListBucket',
              ],
              resources: [bucketArn, pulumi.interpolate`${bucketArn}/*`],
            },
          ],
        });
      });

    new aws.s3.BucketPolicy(
      'bulk-upload-bucket-policy',
      {
        bucket: this.bucket.bucket,
        policy: allowAccessPolicy.apply((policy) => policy.json),
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
