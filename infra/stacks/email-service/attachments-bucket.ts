import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { createBucket } from '@resources/resources/bucket';
import { stack } from '@shared';

const isLocal = stack === 'local';
const BASE_NAME = `macro-email-attachments-${stack}`;

interface EmailAttachmentsBucketArgs {
  emailServiceRoleArn?: pulumi.Output<string> | string;
}

export class EmailAttachmentsBucket extends pulumi.ComponentResource {
  bucket: aws.s3.Bucket;

  constructor(
    name: string,
    args: EmailAttachmentsBucketArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:EmailAttachmentsBucket', name, {}, opts);
    const { emailServiceRoleArn } = args;

    if (!isLocal && emailServiceRoleArn === undefined) {
      throw new Error('emailServiceRoleArn must be set for non-local stacks');
    } else if (isLocal && emailServiceRoleArn !== undefined) {
      throw new Error('emailServiceRoleArn must not be set for local stacks');
    }

    this.bucket = createBucket({
      id: BASE_NAME,
      bucketName: BASE_NAME,
      transferAcceleration: stack === 'prod',
      lifecycleRules: [
        {
          id: `email-attachments-${stack}-cleanup`,
          enabled: true,
          expiration: {
            days: 1,
          },
        },
      ],
    });

    new aws.s3.BucketPublicAccessBlock(
      'email-attachments-bucket-public-access-block',
      {
        bucket: this.bucket.id,
        blockPublicAcls: !isLocal,
        blockPublicPolicy: !isLocal,
        ignorePublicAcls: !isLocal,
        restrictPublicBuckets: !isLocal,
      },
      { parent: this }
    );

    if (!isLocal) {
      new aws.s3.BucketNotification(
        `${BASE_NAME}-notification`,
        {
          bucket: this.bucket.id,
          eventbridge: true,
        },
        { parent: this }
      );
    }
  }

  attachCloudfrontPolicy({
    cloudfrontDistributionArn,
    emailServiceRoleArn,
  }: {
    cloudfrontDistributionArn: pulumi.Output<string>;
    emailServiceRoleArn?: pulumi.Output<string> | string;
  }) {
    const policy = pulumi
      .all([this.bucket.arn, cloudfrontDistributionArn, emailServiceRoleArn])
      .apply(([bucketArn, cfArn, roleArn]) => {
        const statements: any[] = [
          {
            Sid: 'AllowCloudFrontServicePrincipal',
            Effect: 'Allow',
            Principal: {
              Service: 'cloudfront.amazonaws.com',
            },
            Action: 's3:GetObject',
            Resource: `${bucketArn}/*`,
            Condition: {
              StringEquals: {
                'AWS:SourceArn': cfArn,
              },
            },
          },
        ];

        if (roleArn) {
          statements.push({
            Sid: 'AllowEmailServiceRole',
            Effect: 'Allow',
            Principal: {
              AWS: roleArn,
            },
            Action: [
              's3:GetObject',
              's3:PutObject',
              's3:GetObjectAttributes',
              's3:ListBucket',
            ],
            Resource: [bucketArn, `${bucketArn}/*`],
          });
        }

        return {
          Version: '2012-10-17',
          Statement: statements,
        };
      });

    new aws.s3.BucketPolicy(
      `${BASE_NAME}-bucket-policy-${stack}`,
      {
        bucket: this.bucket.id,
        policy: policy.apply((p) => JSON.stringify(p)),
      },
      { parent: this }
    );
  }
}
