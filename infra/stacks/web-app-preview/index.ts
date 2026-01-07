import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import {
  BASE_DOMAIN,
  MACRO_SUBDOMAIN_CERT,
  stack,
} from '../../packages/shared/src';

const BASE_NAME = 'preview-deploy';

const tags = {
  environment: stack,
  project: 'web-app-preview',
};

// S3 bucket for preview deployments
const previewBucket = new aws.s3.Bucket(`${BASE_NAME}-bucket`, {
  bucket: `macro-preview-assets-${stack}`,
  tags,
});

// Lifecycle rule to expire preview files after 7 days
new aws.s3.BucketLifecycleConfiguration(`${BASE_NAME}-lifecycle`, {
  bucket: previewBucket.id,
  rules: [
    {
      id: 'expire-previews-after-7-days',
      status: 'Enabled',
      expiration: {
        days: 7,
      },
    },
  ],
});

// Block public access - CloudFront will access via OAC
new aws.s3.BucketPublicAccessBlock(`${BASE_NAME}-public-access-block`, {
  bucket: previewBucket.id,
  blockPublicAcls: true,
  blockPublicPolicy: true,
  ignorePublicAcls: true,
  restrictPublicBuckets: true,
});

// Origin Access Control for CloudFront to access S3
const originAccessControl = new aws.cloudfront.OriginAccessControl(
  `${BASE_NAME}-oac`,
  {
    name: `${BASE_NAME}-oac-${stack}`,
    originAccessControlOriginType: 's3',
    signingBehavior: 'always',
    signingProtocol: 'sigv4',
  }
);

// IAM role for Lambda@Edge
const lambdaRole = new aws.iam.Role(`${BASE_NAME}-lambda-role`, {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: ['lambda.amazonaws.com', 'edgelambda.amazonaws.com'],
  }),
  tags,
});

new aws.iam.RolePolicyAttachment(`${BASE_NAME}-lambda-role-attach`, {
  role: lambdaRole,
  policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
});

// Lambda@Edge: Origin Request - routes subdomain to S3 prefix
const originRequestLambda = new aws.lambda.Function(
  `${BASE_NAME}-origin-request`,
  {
    code: new pulumi.asset.FileArchive('./previewOriginRequestLambda'),
    role: lambdaRole.arn,
    handler: 'index.handler',
    runtime: aws.lambda.Runtime.NodeJS20dX,
    name: `${BASE_NAME}-origin-request-${stack}`,
    publish: true,
    tags,
  },
  {
    // Lambda@Edge must be in us-east-1
    provider: new aws.Provider('us-east-1-provider', { region: 'us-east-1' }),
  }
);


// S3 bucket regional domain name
const bucketRegionalDomainName = pulumi.interpolate`${previewBucket.bucket}.s3.us-east-1.amazonaws.com`;

// Cache policy for previews (short TTL since content changes frequently)
const cachePolicy = new aws.cloudfront.CachePolicy(`${BASE_NAME}-cache-policy`, {
  name: `${BASE_NAME}-cache-policy-${stack}`,
  defaultTtl: 60, // 1 minute default
  minTtl: 0,
  maxTtl: 86400, // 1 day max
  parametersInCacheKeyAndForwardedToOrigin: {
    cookiesConfig: {
      cookieBehavior: 'none',
    },
    headersConfig: {
      headerBehavior: 'whitelist',
      headers: {
        items: ['Host'], // Need Host header for subdomain routing
      },
    },
    queryStringsConfig: {
      queryStringBehavior: 'none',
    },
  },
});

// Response headers policy
const responseHeadersPolicy = new aws.cloudfront.ResponseHeadersPolicy(
  `${BASE_NAME}-response-headers-policy`,
  {
    name: `${BASE_NAME}-response-headers-policy-${stack}`,
    corsConfig: {
      accessControlAllowOrigins: { items: ['*'] },
      accessControlAllowHeaders: { items: ['*'] },
      accessControlAllowMethods: { items: ['ALL'] },
      accessControlMaxAgeSec: 300,
      accessControlAllowCredentials: false,
      originOverride: true,
    },
    securityHeadersConfig: {
      strictTransportSecurity: {
        accessControlMaxAgeSec: 31536000,
        includeSubdomains: true,
        preload: false,
        override: false,
      },
      contentTypeOptions: {
        override: true,
      },
    },
  }
);

// Wildcard alias for preview subdomains
const previewAlias = `*-preview.${BASE_DOMAIN}`;

// CloudFront distribution for preview deployments
const distribution = new aws.cloudfront.Distribution(
  `${BASE_NAME}-distribution`,
  {
    comment: `(${stack}) Preview deployments for web app`,
    aliases: [previewAlias],
    viewerCertificate: {
      cloudfrontDefaultCertificate: false,
      acmCertificateArn: MACRO_SUBDOMAIN_CERT,
      sslSupportMethod: 'sni-only',
      minimumProtocolVersion: 'TLSv1.2_2021',
    },
    defaultCacheBehavior: {
      allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
      cachedMethods: ['GET', 'HEAD', 'OPTIONS'],
      compress: true,
      targetOriginId: previewBucket.id,
      viewerProtocolPolicy: 'redirect-to-https',
      cachePolicyId: cachePolicy.id,
      responseHeadersPolicyId: responseHeadersPolicy.id,
      lambdaFunctionAssociations: [
        {
          eventType: 'origin-request',
          lambdaArn: pulumi.interpolate`${originRequestLambda.arn}:${originRequestLambda.version}`,
          includeBody: false,
        },
      ],
    },
    enabled: true,
    defaultRootObject: 'index.html',
    origins: [
      {
        domainName: bucketRegionalDomainName,
        originId: previewBucket.id,
        originAccessControlId: originAccessControl.id,
      },
    ],
    restrictions: {
      geoRestriction: {
        restrictionType: 'none',
      },
    },
    httpVersion: 'http2and3',
    tags,
  }
);

// S3 bucket policy to allow CloudFront access via OAC
new aws.s3.BucketPolicy(`${BASE_NAME}-bucket-policy`, {
  bucket: previewBucket.id,
  policy: pulumi
    .all([previewBucket.arn, distribution.arn])
    .apply(([bucketArn, distArn]) =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
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
                'AWS:SourceArn': distArn,
              },
            },
          },
        ],
      })
    ),
});

// Route53 wildcard record for preview subdomains
const zone = aws.route53.getZoneOutput({ name: BASE_DOMAIN });

new aws.route53.Record(`${BASE_NAME}-dns-record`, {
  name: `*-preview`,
  zoneId: zone.zoneId,
  type: 'A',
  aliases: [
    {
      name: distribution.domainName,
      zoneId: distribution.hostedZoneId,
      evaluateTargetHealth: false,
    },
  ],
});

// Exports
export const previewBucketName = previewBucket.bucket;
export const previewBucketArn = previewBucket.arn;
export const previewDistributionId = distribution.id;
export const previewDistributionDomain = distribution.domainName;
export const previewBaseUrl = `https://{subdomain}-preview.${BASE_DOMAIN}`;
