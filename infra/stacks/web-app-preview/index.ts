import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import {
  BASE_DOMAIN,
  stack,
} from '../../packages/shared/src';

const BASE_NAME = 'preview-deploy';

// Certificate must be in us-east-1 for CloudFront
const usEast1Provider = new aws.Provider('us-east-1-provider', {
  region: 'us-east-1',
});

// Create certificate for *.preview.macro.com
const previewCert = new aws.acm.Certificate(
  `${BASE_NAME}-cert`,
  {
    domainName: `*.preview.${BASE_DOMAIN}`,
    validationMethod: 'DNS',
    tags: {
      environment: stack,
      project: 'web-app-preview',
    },
  },
  { provider: usEast1Provider }
);

// Get the hosted zone for DNS validation
const zone = aws.route53.getZoneOutput({ name: BASE_DOMAIN });

// Create DNS validation record
const certValidation = new aws.route53.Record(
  `${BASE_NAME}-cert-validation`,
  {
    name: previewCert.domainValidationOptions[0].resourceRecordName,
    type: previewCert.domainValidationOptions[0].resourceRecordType,
    zoneId: zone.zoneId,
    records: [previewCert.domainValidationOptions[0].resourceRecordValue],
    ttl: 60,
  }
);

// Wait for certificate validation
const certValidated = new aws.acm.CertificateValidation(
  `${BASE_NAME}-cert-validated`,
  {
    certificateArn: previewCert.arn,
    validationRecordFqdns: [certValidation.fqdn],
  },
  { provider: usEast1Provider }
);

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

// Lambda@Edge: Viewer Request - rewrites URI based on subdomain
const viewerRequestLambda = new aws.lambda.Function(
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
    provider: usEast1Provider,
  }
);


const bucketRegionalDomainName = pulumi.interpolate`${previewBucket.bucket}.s3.us-east-1.amazonaws.com`;

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
      headerBehavior: 'none',
    },
    queryStringsConfig: {
      queryStringBehavior: 'none',
    },
  },
});

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

const previewAlias = `*.preview.${BASE_DOMAIN}`;

const distribution = new aws.cloudfront.Distribution(
  `${BASE_NAME}-distribution`,
  {
    comment: `(${stack}) Preview deployments for web app`,
    aliases: [previewAlias],
    viewerCertificate: {
      cloudfrontDefaultCertificate: false,
      acmCertificateArn: certValidated.certificateArn,
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
          eventType: 'viewer-request',
          lambdaArn: pulumi.interpolate`${viewerRequestLambda.arn}:${viewerRequestLambda.version}`,
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

new aws.route53.Record(`${BASE_NAME}-dns-record`, {
  name: `*.preview`,
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

export const previewBucketName = previewBucket.bucket;
export const previewBucketArn = previewBucket.arn;
export const previewDistributionId = distribution.id;
export const previewDistributionDomain = distribution.domainName;
export const previewBaseUrl = `https://{subdomain}.preview.${BASE_DOMAIN}`;
