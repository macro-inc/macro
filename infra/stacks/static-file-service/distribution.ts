import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

interface StaticFileCloudFrontArgs {
  bucket: aws.s3.Bucket;
  api: aws.lb.LoadBalancer;
  stackName: string;
  // Optional parameters
  geoRestrictions?: {
    restrictionType: 'whitelist' | 'blacklist';
    locations: string[];
  };
  customDomain?: {
    aliases: string[];
    certificateArn: string;
  };
  notFoundPage: aws.s3.BucketObject;
  tags: { [key: string]: string };
}

export class StaticFileCloudFront extends pulumi.ComponentResource {
  public readonly distribution: aws.cloudfront.Distribution;
  public readonly s3AccessControl: aws.cloudfront.OriginAccessControl;
  public readonly tags: { [key: string]: string };

  constructor(
    name: string,
    args: StaticFileCloudFrontArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('custom:cdn:StaticFileCloudFront', name, {}, opts);
    this.tags = args.tags;

    // Create Origin Access Control for the CloudFront distribution
    this.s3AccessControl = new aws.cloudfront.OriginAccessControl(
      `${name}-s3-oac`,
      {
        description: 'Origin Access Control for Static Files',
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
      },
      { parent: this }
    );

    const s3OriginId = `static-file-bucket`;
    const apiOriginId = `static-file-api`;

    const responseHeadersPolicy = new aws.cloudfront.ResponseHeadersPolicy(
      'corp-policy',
      {
        customHeadersConfig: {
          items: [
            {
              header: 'Cross-Origin-Resource-Policy',
              override: true,
              value: 'cross-origin',
            },
          ],
        },
      }
    );

    // Create the CloudFront distribution
    this.distribution = new aws.cloudfront.Distribution(
      `${name}-distribution`,
      {
        origins: [
          {
            domainName: args.bucket.bucketRegionalDomainName,
            originAccessControlId: this.s3AccessControl.id,
            originId: s3OriginId,
          },
          {
            domainName: args.api.dnsName,
            customOriginConfig: {
              httpPort: 80,
              httpsPort: 443,
              originProtocolPolicy: 'https-only',
              originSslProtocols: ['TLSv1.2'],
            },
            originId: apiOriginId,
          },
        ],
        enabled: true,
        isIpv6Enabled: true,
        comment: `Static files distribution for ${name}`,
        orderedCacheBehaviors: [
          {
            allowedMethods: ['HEAD', 'GET', 'OPTIONS'],
            pathPattern: '/file/*',
            targetOriginId: s3OriginId,
            cachedMethods: ['GET', 'OPTIONS', 'HEAD'],
            viewerProtocolPolicy: 'redirect-to-https',
            forwardedValues: {
              queryString: true,
              headers: ['Origin'],
              cookies: {
                forward: 'none',
              },
            },
            responseHeadersPolicyId: responseHeadersPolicy.id,
            minTtl: 0,
            defaultTtl: 31536000,
            maxTtl: 31536000,
            compress: true,
          },
          {
            allowedMethods: [
              'GET',
              'POST',
              'PUT',
              'PATCH',
              'DELETE',
              'OPTIONS',
              'HEAD',
            ],
            pathPattern: '/api/*',
            targetOriginId: apiOriginId,
            cachedMethods: ['GET', 'OPTIONS', 'HEAD'],
            viewerProtocolPolicy: 'redirect-to-https',
            forwardedValues: {
              headers: ['*'],
              queryString: true,
              cookies: {
                forward: 'all',
              },
            },
            minTtl: 0,
            defaultTtl: 0,
            maxTtl: 0,
          },
          {
            allowedMethods: [
              'GET',
              'POST',
              'PUT',
              'PATCH',
              'DELETE',
              'OPTIONS',
              'HEAD',
            ],
            pathPattern: '/internal/*',
            targetOriginId: apiOriginId,
            cachedMethods: ['GET', 'OPTIONS', 'HEAD'],
            viewerProtocolPolicy: 'redirect-to-https',
            forwardedValues: {
              headers: ['*'],
              queryString: true,
              cookies: {
                forward: 'all',
              },
            },
            minTtl: 0,
            defaultTtl: 0,
            maxTtl: 0,
          },
        ],
        defaultCacheBehavior: {
          allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
          cachedMethods: ['GET', 'HEAD', 'OPTIONS'],
          targetOriginId: s3OriginId,
          forwardedValues: {
            queryString: false,
            cookies: {
              forward: 'none',
            },
          },
          viewerProtocolPolicy: 'redirect-to-https',
          minTtl: 0,
          defaultTtl: 2628000, // 1 week
          maxTtl: 7884000, // 3 months
          compress: true,
        },
        priceClass: 'PriceClass_100',
        restrictions: {
          geoRestriction: args.geoRestrictions || {
            restrictionType: 'none',
            locations: [],
          },
        },
        viewerCertificate: args.customDomain
          ? {
              acmCertificateArn: args.customDomain.certificateArn,
              sslSupportMethod: 'sni-only',
              minimumProtocolVersion: 'TLSv1.2_2021',
            }
          : {
              cloudfrontDefaultCertificate: true,
            },
        aliases: args.customDomain?.aliases,
        tags: {
          Environment: args.stackName,
        },
        customErrorResponses: [
          {
            errorCode: 403,
            errorCachingMinTtl: 0,
            responseCode: 404,
            responsePagePath: pulumi.interpolate!`/${args.notFoundPage.key}`,
          },
        ],
      },
      {
        parent: this,
        dependsOn: args.notFoundPage,
      }
    );

    // Configure bucket to allow CloudFront access
    new aws.s3.BucketPublicAccessBlock(
      `${name}-access-block`,
      {
        bucket: args.bucket.id,
        blockPublicAcls: true,
        blockPublicPolicy: false, // Must be false to allow CloudFront
        ignorePublicAcls: true,
        restrictPublicBuckets: false, // Must be false to allow CloudFront,
      },
      { parent: this }
    );

    // Create bucket policy to allow CloudFront access
    new aws.s3.BucketPolicy(
      `${name}-bucket-policy`,
      {
        bucket: args.bucket.id,
        policy: pulumi
          .all([args.bucket.arn, this.distribution.arn])
          .apply(([bucketArn, distributionArn]) =>
            JSON.stringify({
              Version: '2012-10-17',
              Statement: [
                {
                  Sid: 'AllowCloudFrontOACGet',
                  Effect: 'Allow',
                  Principal: {
                    Service: 'cloudfront.amazonaws.com',
                  },
                  Action: 's3:GetObject',
                  Resource: `${bucketArn}/*`,
                  Condition: {
                    StringEquals: {
                      'AWS:SourceArn': distributionArn,
                    },
                  },
                },
              ],
            })
          ),
      },
      { parent: this }
    );

    this.registerOutputs({
      distribution: this.distribution,
      originAccessControl: this.s3AccessControl,
    });
  }
}
