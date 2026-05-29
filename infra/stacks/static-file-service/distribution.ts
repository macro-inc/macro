import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

interface StaticFileCloudFrontArgs {
  bucket: aws.s3.Bucket;
  imageOptimizerUrl: pulumi.Output<string>;
  imageOptimizerFunctionName: pulumi.Output<string>;
  api: aws.lb.LoadBalancer;
  stackName: string;
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

const IMAGE_URL_REWRITE_FUNCTION = `
function handler(event) {
  var request = event.request;
  var size = request.querystring.size;

  if (!size) return request;

  request.uri += '/size=' + size.value;
  request.querystring = {};
  return request;
}
`;

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

    const lambdaAccessControl = new aws.cloudfront.OriginAccessControl(
      `${name}-lambda-oac`,
      {
        description: 'Origin Access Control for Image Optimizer Lambda',
        originAccessControlOriginType: 'lambda',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
      },
      { parent: this }
    );

    const s3OriginId = 'static-file-bucket';
    const lambdaOriginId = 'image-optimizer-lambda';
    const apiOriginId = 'static-file-api';
    const originGroupId = 'image-optimization-group';

    const imageUrlRewrite = new aws.cloudfront.Function(
      `${name}-image-url-rewrite`,
      {
        name: `image-url-rewrite-${args.stackName}`,
        runtime: 'cloudfront-js-2.0',
        code: IMAGE_URL_REWRITE_FUNCTION,
        publish: true,
      },
      { parent: this }
    );

    const responseHeadersPolicy = new aws.cloudfront.ResponseHeadersPolicy(
      'corp-policy',
      {
        corsConfig: {
          accessControlAllowCredentials: false,
          accessControlAllowHeaders: { items: ['*'] },
          accessControlAllowMethods: { items: ['GET', 'HEAD', 'OPTIONS'] },
          accessControlAllowOrigins: { items: ['*'] },
          accessControlMaxAgeSec: 3000,
          originOverride: true,
        },
        securityHeadersConfig: {
          contentSecurityPolicy: {
            contentSecurityPolicy:
              "default-src 'none'; style-src 'unsafe-inline'; img-src data:;",
            override: true,
          },
        },
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

    // S3 bucket for CloudFront standard access logs
    const logBucket = new aws.s3.BucketV2(
      `${name}-cf-logs-bucket`,
      {
        bucket: `static-file-cf-logs-${args.stackName}`,
        forceDestroy: args.stackName !== 'prod',
        tags: args.tags,
      },
      { parent: this }
    );

    const logBucketOwnership = new aws.s3.BucketOwnershipControls(
      `${name}-cf-logs-ownership`,
      {
        bucket: logBucket.id,
        rule: {
          objectOwnership: 'BucketOwnerPreferred',
        },
      },
      { parent: this }
    );

    new aws.s3.BucketAclV2(
      `${name}-cf-logs-acl`,
      {
        bucket: logBucket.id,
        accessControlPolicy: {
          owner: {
            id: logBucket.id.apply(() =>
              aws.s3.getCanonicalUserId().then((r) => r.id)
            ),
          },
          grants: [
            {
              grantee: {
                id: 'c4c1ede66af53448b93c283ce9448c4ba468c9432aa01d700d3878632f77d2d0',
                type: 'CanonicalUser',
              },
              permission: 'FULL_CONTROL',
            },
          ],
        },
      },
      { parent: this, dependsOn: [logBucketOwnership] }
    );

    new aws.s3.BucketLifecycleConfigurationV2(
      `${name}-cf-logs-lifecycle`,
      {
        bucket: logBucket.id,
        rules: [
          {
            id: 'expire-logs-7-days',
            status: 'Enabled',
            expiration: {
              days: 7,
            },
          },
        ],
      },
      { parent: this }
    );

    const lambdaDomainName = args.imageOptimizerUrl.apply((url) =>
      url.replace('https://', '').replace(/\/+$/, '')
    );

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
            domainName: lambdaDomainName,
            originAccessControlId: lambdaAccessControl.id,
            customOriginConfig: {
              httpPort: 80,
              httpsPort: 443,
              originProtocolPolicy: 'https-only',
              originSslProtocols: ['TLSv1.2'],
            },
            originId: lambdaOriginId,
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
        originGroups: [
          {
            originId: originGroupId,
            failoverCriteria: {
              statusCodes: [403, 404, 500, 502, 503, 504],
            },
            members: [{ originId: s3OriginId }, { originId: lambdaOriginId }],
          },
        ],
        enabled: true,
        isIpv6Enabled: true,
        comment: `Static files distribution for ${name}`,
        orderedCacheBehaviors: [
          {
            allowedMethods: ['HEAD', 'GET', 'OPTIONS'],
            pathPattern: '/file/*',
            targetOriginId: originGroupId,
            cachedMethods: ['GET', 'OPTIONS', 'HEAD'],
            viewerProtocolPolicy: 'redirect-to-https',
            forwardedValues: {
              queryString: false,
              headers: ['Origin'],
              cookies: {
                forward: 'none',
              },
            },
            functionAssociations: [
              {
                eventType: 'viewer-request',
                functionArn: imageUrlRewrite.arn,
              },
            ],
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
          defaultTtl: 2628000,
          maxTtl: 7884000,
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
        loggingConfig: {
          bucket: logBucket.bucketDomainName,
          includeCookies: false,
          prefix: 'cf-logs/',
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

    new aws.cloudfront.MonitoringSubscription(
      `${name}-monitoring-subscription`,
      {
        distributionId: this.distribution.id,
        monitoringSubscription: {
          realtimeMetricsSubscriptionConfig: {
            realtimeMetricsSubscriptionStatus: 'Enabled',
          },
        },
      },
      { parent: this }
    );

    // Allow CloudFront to read from and Lambda to write to the bucket
    new aws.s3.BucketPublicAccessBlock(
      `${name}-access-block`,
      {
        bucket: args.bucket.id,
        blockPublicAcls: true,
        blockPublicPolicy: false,
        ignorePublicAcls: true,
        restrictPublicBuckets: false,
      },
      { parent: this }
    );

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

    new aws.lambda.Permission(
      `${name}-lambda-cloudfront-permission`,
      {
        action: 'lambda:InvokeFunctionUrl',
        function: args.imageOptimizerFunctionName,
        principal: 'cloudfront.amazonaws.com',
        sourceArn: this.distribution.arn,
      },
      { parent: this }
    );

    this.registerOutputs({
      distribution: this.distribution,
      originAccessControl: this.s3AccessControl,
    });
  }
}
