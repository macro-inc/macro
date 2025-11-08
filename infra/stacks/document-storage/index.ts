import * as aws from '@pulumi/aws';
import { createBucket } from '@resources';
import { stack } from '@shared';
import { get_coparse_api_vpc } from '@vpc';
import { getRedisInstance } from './cloud-storage-cache';
import { setupReplicationBucket } from './replication-bucket';

// ------------------------------------------- VPC -------------------------------------------
export const coparse_api_vpc = get_coparse_api_vpc();

// ------------------------------------------- BUCKET -------------------------------------------
const documentStorageBucket = createBucket({
  id: `document-storage-${stack}`,
  // prod bucket name was taken
  bucketName:
    stack === 'prod' ? `macro-document-storage-prod` : `doc-storage-${stack}`,
  transferAcceleration: stack === 'prod',
  enableVersioning: true,
  lifecycleRules: [
    {
      id: `doc-storage-${stack}-temp-cleanup`,
      prefix: 'temp_files/',
      enabled: true,
      expiration: {
        days: 1,
      },
    },
    {
      id: `delete-marked-files-${stack}`,
      enabled: true,
      expiration: {
        expiredObjectDeleteMarker: true,
      },
    },
  ],
  exposeHeaders: ['Content-Length', 'Content-Range'],
});

new aws.s3.BucketNotification('eventbridgeNotification', {
  bucket: documentStorageBucket.id,
  eventbridge: true,
});

const replication = setupReplicationBucket();

new aws.s3.BucketReplicationConfig(
  `replication`,
  {
    role: replication.role.arn,
    bucket: documentStorageBucket.id,
    rules: [
      {
        status: 'Enabled',
        filter: {
          prefix: '',
        },
        deleteMarkerReplication: {
          status: 'Enabled',
        },
        destination: {
          bucket: replication.bucket.arn,
          storageClass: 'STANDARD',
        },
      },
    ],
  },
  {
    dependsOn: [documentStorageBucket, replication.bucket, replication.role],
  }
);

export const documentStorageBucketReplicationRoleArn = replication.role.arn;

export const documentStorageBucketId = documentStorageBucket.id;
export const documentStorageBucketArn = documentStorageBucket.arn;
export const documentStorageBucketName = documentStorageBucket.id;

// ------------------------------------------- Redis -------------------------------------------
const cloudStorageCache = getRedisInstance(coparse_api_vpc);
export const cloudStorageCacheEndpoint = cloudStorageCache.redisEndpoint;

// ------------------------------------------- SERVICE -------------------------------------------
const cluster = new aws.ecs.Cluster(`document-storage-cluster-${stack}`, {
  name: `cloud-storage-cluster-${stack}`,
  settings: [{ name: 'containerInsights', value: 'enabled' }],
});

export const cloudStorageClusterName = cluster.name;
export const cloudStorageClusterArn = cluster.arn;
