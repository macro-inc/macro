import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { createBucketV2 } from '../../packages/resources';
import { ServiceDynamoDBTable } from '../../packages/service';
import { stack } from '../../packages/shared';

const BASE_NAME = pulumi.getProject();

/** What the task role may do with a bucket key, through S3. */
const BUCKET_KEY_ACTIONS = [
  'kms:Encrypt',
  'kms:Decrypt',
  'kms:GenerateDataKey',
  'kms:DescribeKey',
];

type GitaiStorageArgs = {
  /** The service's task role, granted read and write on everything here. */
  taskRole: aws.iam.Role;
  tags: { [key: string]: string };
};

/**
 * gitai-service's state: the events and sessions buckets, each with its own
 * customer-managed KMS key, and the DynamoDB index table. All of it is
 * protected in prod.
 */
export class GitaiStorage extends pulumi.ComponentResource {
  public readonly eventsBucket: aws.s3.BucketV2;
  public readonly sessionsBucket: aws.s3.BucketV2;
  public readonly table: aws.dynamodb.Table;

  constructor(
    name: string,
    { taskRole, tags }: GitaiStorageArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:GitaiStorage', name, {}, opts);
    const stateful = { parent: this, protect: stack === 'prod' };

    // Commits, usage, notes and raw batches: kept, versioned, moved to
    // Infrequent Access after 90 days.
    const eventsKey = this.bucketKey('events', taskRole, tags, stateful);
    this.eventsBucket = this.privateBucket(
      'events',
      eventsKey,
      {
        enableVersioning: true,
        lifecycleRules: [
          {
            id: 'infrequent-access-after-90-days',
            status: 'Enabled',
            filter: {},
            transitions: [{ days: 90, storageClass: 'STANDARD_IA' }],
          },
        ],
      },
      tags,
      stateful
    );

    // Transcripts and their per-batch index: unversioned so a delete is
    // real, expired after 180 days.
    const sessionsKey = this.bucketKey('sessions', taskRole, tags, stateful);
    this.sessionsBucket = this.privateBucket(
      'sessions',
      sessionsKey,
      {
        enableVersioning: false,
        lifecycleRules: ['sessions/', 'session-index/'].map((prefix) => ({
          id: `expire-${prefix.replace('/', '')}-after-180-days`,
          status: 'Enabled',
          filter: { prefix },
          expiration: { days: 180 },
        })),
      },
      tags,
      stateful
    );

    const index = new ServiceDynamoDBTable(
      BASE_NAME,
      'index',
      {
        name: `${BASE_NAME}-index-${stack}`,
        hashKey: 'pk',
        rangeKey: 'sk',
        attributes: [
          { name: 'pk', type: 'S' },
          { name: 'sk', type: 'S' },
          { name: 'gsi1pk', type: 'S' },
          { name: 'gsi1sk', type: 'S' },
        ],
        // Lookups by another key: a credential's hash, a pull request number.
        globalSecondaryIndexes: [
          {
            name: 'gsi1',
            hashKey: 'gsi1pk',
            rangeKey: 'gsi1sk',
            projectionType: 'ALL',
          },
        ],
        ttl: { attributeName: 'expires_at', enabled: true },
        pointInTimeRecoveryEnabled: stack === 'prod',
        tags,
      },
      stateful
    );
    this.table = index.table;

    new aws.iam.RolePolicyAttachment(
      `${BASE_NAME}-index-access`,
      { role: taskRole.name, policyArn: index.policy.arn },
      { parent: this }
    );

    new aws.iam.RolePolicy(
      `${BASE_NAME}-bucket-access`,
      {
        role: taskRole.id,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['s3:ListBucket'],
              Resource: [this.eventsBucket.arn, this.sessionsBucket.arn],
            },
            {
              Effect: 'Allow',
              Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
              Resource: [
                pulumi.interpolate`${this.eventsBucket.arn}/*`,
                pulumi.interpolate`${this.sessionsBucket.arn}/*`,
              ],
            },
            {
              Effect: 'Allow',
              Action: BUCKET_KEY_ACTIONS,
              Resource: [eventsKey.arn, sessionsKey.arn],
            },
          ],
        },
      },
      { parent: this }
    );
  }

  /**
   * A customer-managed key for one bucket. The account administers it; only
   * the task role uses it.
   */
  private bucketKey(
    purpose: string,
    taskRole: aws.iam.Role,
    tags: { [key: string]: string },
    opts: pulumi.CustomResourceOptions
  ) {
    const accountRootArn = pulumi.interpolate`arn:aws:iam::${aws.getCallerIdentityOutput().accountId}:root`;
    const key = new aws.kms.Key(
      `${BASE_NAME}-${purpose}-key`,
      {
        description: `${BASE_NAME} ${purpose} bucket encryption for ${stack}`,
        deletionWindowInDays: 30,
        enableKeyRotation: true,
        policy: aws.iam.getPolicyDocumentOutput({
          statements: [
            {
              sid: 'AllowAccountKeyAdministration',
              effect: 'Allow',
              principals: [{ type: 'AWS', identifiers: [accountRootArn] }],
              actions: [
                'kms:CancelKeyDeletion',
                'kms:Create*',
                'kms:Delete*',
                'kms:Describe*',
                'kms:Disable*',
                'kms:Enable*',
                'kms:Get*',
                'kms:List*',
                'kms:Put*',
                'kms:Revoke*',
                'kms:ScheduleKeyDeletion',
                'kms:TagResource',
                'kms:UntagResource',
                'kms:Update*',
              ],
              resources: ['*'],
            },
            {
              sid: 'AllowServiceBucketEncryption',
              effect: 'Allow',
              principals: [{ type: 'AWS', identifiers: [taskRole.arn] }],
              actions: BUCKET_KEY_ACTIONS,
              resources: ['*'],
            },
          ],
        }).json,
        tags,
      },
      opts
    );
    new aws.kms.Alias(
      `${BASE_NAME}-${purpose}-key-alias`,
      {
        name: `alias/${BASE_NAME}-${purpose}-${stack}`,
        targetKeyId: key.keyId,
      },
      { parent: this }
    );
    return key;
  }

  /**
   * `gitai-<purpose>-<stack>`: no CORS (no browser reads it), SSE-KMS with a
   * bucket key, all public access blocked, and plain-HTTP requests denied.
   */
  private privateBucket(
    purpose: string,
    key: aws.kms.Key,
    {
      enableVersioning,
      lifecycleRules,
    }: {
      enableVersioning: boolean;
      lifecycleRules: aws.types.input.s3.BucketLifecycleConfigurationV2Rule[];
    },
    tags: { [key: string]: string },
    opts: pulumi.CustomResourceOptions
  ) {
    const bucketName = `gitai-${purpose}-${stack}`;
    const bucket = createBucketV2(
      {
        id: bucketName,
        bucketName,
        transferAcceleration: false,
        cors: false,
        enableVersioning,
        lifecycleRules,
        tags,
      },
      opts
    );

    new aws.s3.BucketServerSideEncryptionConfigurationV2(
      `${bucketName}-encryption`,
      {
        bucket: bucket.id,
        rules: [
          {
            applyServerSideEncryptionByDefault: {
              sseAlgorithm: 'aws:kms',
              kmsMasterKeyId: key.arn,
            },
            bucketKeyEnabled: true,
          },
        ],
      },
      opts
    );

    const publicAccessBlock = new aws.s3.BucketPublicAccessBlock(
      `${bucketName}-public-access-block`,
      {
        bucket: bucket.id,
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      },
      opts
    );

    new aws.s3.BucketPolicy(
      `${bucketName}-policy`,
      {
        bucket: bucket.id,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'DenyInsecureTransport',
              Effect: 'Deny',
              Principal: '*',
              Action: 's3:*',
              Resource: [bucket.arn, pulumi.interpolate`${bucket.arn}/*`],
              Condition: { Bool: { 'aws:SecureTransport': 'false' } },
            },
          ],
        },
      },
      // S3 rejects a policy write that races the public access block.
      { ...opts, dependsOn: [publicAccessBlock] }
    );

    return bucket;
  }
}
