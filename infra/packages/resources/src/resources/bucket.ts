import * as aws from '@pulumi/aws';
import type { Bucket } from '@pulumi/aws/s3';
import type * as pulumi from '@pulumi/pulumi';
import { stack } from '@shared';
import { ALLOWED_ORIGINS } from './cors';

/**
 * @description Creates the s3 bucket to act as document storage
 */
export function createBucket({
  id,
  bucketName,
  transferAcceleration,
  lifecycleRules,
  enableVersioning,
  exposeHeaders,
}: {
  id: string;
  bucketName: string;
  transferAcceleration: boolean;
  lifecycleRules?: aws.types.input.s3.BucketLifecycleRule[];
  enableVersioning?: boolean;
  exposeHeaders?: string[];
}): Bucket {
  // Document Storage S3 Bucket
  // The bucket policy for this bucket is not stored in code as then it could be manipulated by any user
  // with pulumi access. The policy is manually created and maintained.
  return new aws.s3.Bucket(id, {
    bucket: bucketName,
    forceDestroy: stack !== 'prod',
    versioning: enableVersioning
      ? {
        enabled: true,
        mfaDelete: false,
      }
      : undefined,
    // Enable transfer acceleration for our production bucket for SPEEDZ
    accelerationStatus: transferAcceleration ? 'Enabled' : undefined,
    lifecycleRules,
    corsRules: [
      {
        allowedHeaders: ['*'],
        allowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
        allowedOrigins: ALLOWED_ORIGINS,
        exposeHeaders: ['ETag', ...(exposeHeaders || [])],
        maxAgeSeconds: 3000,
      },
    ],
    logging: stack === 'prod' ? {
      targetBucket: 'macro-logging-bucket',
      targetPrefix: `${bucketName}/`,
    } : undefined,
    // loggings:
    //   stack === 'prod'
    //     ? [
    //         {
    //           targetBucket: 'macro-logging-bucket',
    //           targetPrefix: `${bucketName}/`,
    //         },
    //       ]
    //     : undefined,
  });
}

/**
 * @description Creates the s3 bucket to act as document storage using BucketV2 API
 */
export function createBucketV2(
  {
    id,
    bucketName,
    transferAcceleration,
    lifecycleRules,
    enableVersioning,
    tags,
  }: {
    id: string;
    bucketName: string;
    transferAcceleration: boolean;
    tags?: { [key: string]: string };
    lifecycleRules?: aws.types.input.s3.BucketLifecycleConfigurationV2Rule[];
    enableVersioning?: boolean;
  },
  opts?: pulumi.CustomResourceOptions
): aws.s3.BucketV2 {
  // Create main S3 Bucket
  const bucket = new aws.s3.BucketV2(
    id,
    {
      bucket: bucketName,
      forceDestroy: stack !== 'prod',
      tags,
    },
    opts
  );

  // Add CORS configuration using BucketCorsConfigurationV2
  new aws.s3.BucketCorsConfigurationV2(
    `${id}-cors`,
    {
      bucket: bucket.id,
      corsRules: [
        {
          allowedHeaders: ['*'],
          allowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
          allowedOrigins: ALLOWED_ORIGINS,
          exposeHeaders: ['ETag'],
          maxAgeSeconds: 3000,
        },
      ],
    },
    { ...opts, dependsOn: [bucket] }
  );

  if (lifecycleRules) {
    new aws.s3.BucketLifecycleConfigurationV2(
      `${id}-lifecycle`,
      {
        bucket: bucket.id,
        rules: lifecycleRules,
      },
      { ...opts, dependsOn: [bucket] }
    );
  }

  if (enableVersioning) {
    new aws.s3.BucketVersioningV2(
      `${id}-versioning`,
      {
        bucket: bucket.id,
        versioningConfiguration: {
          status: 'Enabled',
          mfaDelete: 'Disabled',
        },
      },
      { ...opts, dependsOn: [bucket] }
    );
  }

  if (transferAcceleration) {
    new aws.s3.BucketAccelerateConfigurationV2(
      `${id}-accelerate`,
      {
        bucket: bucket.id,
        status: 'Enabled',
      },
      { ...opts, dependsOn: [bucket] }
    );
  }

  if (stack === 'prod') {
    new aws.s3.BucketLoggingV2(
      `${id}-logging`,
      {
        bucket: bucket.id,
        targetBucket: 'macro-logging-bucket',
        targetPrefix: `${bucketName}/`,
      },
      { ...opts, dependsOn: [bucket] }
    );
  }

  return bucket;
}
