import * as fs from 'fs';
import * as aws from '@pulumi/aws';
import * as command from '@pulumi/command';
import * as pulumi from '@pulumi/pulumi';
import { hasItems } from '../../packages/utils';

const config = new pulumi.Config();

const certArn = config.require('certArn');
const domain = config.require('domain');
const subdomain = config.require('subdomain');
const domainName = `${subdomain}.${domain}`;
const stack = pulumi.getStack();
const staticSiteDir = '../../../apps/marketing/dist';

// The sync never deletes, so an unbuilt dist would "deploy" nothing and still invalidate.
if (!hasItems(staticSiteDir)) {
  throw new Error(`Website build output is empty: ${staticSiteDir}`);
}

const tags = {
  project: 'website',
  environment: stack,
  owner: 'boswell',
};

const zone = aws.route53.getZoneOutput({ name: domain });

const webAclId = aws.wafv2
  .getWebAcl({
    name: 'macro-global-web-acl',
    scope: 'CLOUDFRONT',
  })
  .then((r) => r.arn);

const websiteAssets = new aws.s3.Bucket(`website-assets-${stack}`, {
  website: {
    indexDocument: 'index.html',
    errorDocument: 'index.html',
  },
  loggings:
    stack === 'prod'
      ? [
          {
            targetBucket: 'macro-logging-bucket',
            targetPrefix: `website-${stack}`,
          },
        ]
      : undefined,
});

const syncAssetsCommand = new command.local.Command(
  'sync-assets-command',
  {
    create: pulumi.interpolate`aws s3 sync ${staticSiteDir} s3://${websiteAssets.bucket} --exclude "*.br" --exclude "*.gz" --exclude "*.mp4" --acl public-read`,
    triggers: [Date.now()],
  },
  { dependsOn: [websiteAssets], replaceOnChanges: ['*'] }
);

const syncVideoAssetsCommand = new command.local.Command(
  'sync-video-assets-command',
  {
    create: pulumi.interpolate`aws s3 sync ${staticSiteDir} s3://${websiteAssets.bucket} --exclude "*" --include "*.mp4" --exclude "video/demo-local.mp4" --acl public-read --size-only --cache-control "public,max-age=86400"`,
    triggers: [Date.now()],
  },
  { dependsOn: [websiteAssets], replaceOnChanges: ['*'] }
);

const syncBrAssetsCommand = new command.local.Command(
  'sync-br-assets-command',
  {
    create: pulumi.interpolate`aws s3 cp ${staticSiteDir} s3://${websiteAssets.bucket} --exclude "*" --include "*.br" --content-encoding br --metadata-directive REPLACE --acl public-read --recursive`,
    triggers: [Date.now()],
  },
  { dependsOn: [websiteAssets], replaceOnChanges: ['*'] }
);

const syncGzAssetsCommand = new command.local.Command(
  'sync-gz-assets-command',
  {
    create: pulumi.interpolate`aws s3 cp ${staticSiteDir} s3://${websiteAssets.bucket} --exclude "*" --include "*.gz" --content-encoding gzip --metadata-directive REPLACE --acl public-read --recursive`,
    triggers: [Date.now()],
  },
  { dependsOn: [websiteAssets], replaceOnChanges: ['*'] }
);

// Prerendered route HTML (index.html, jobs/index.html, posts/*/index.html, …)
// must never be cached by browsers; CloudFront still caches and is
// invalidated on deploy.
const syncIndexHtmlCommand = new command.local.Command(
  'sync-index-html-command',
  {
    create: pulumi.interpolate`aws s3 cp ${staticSiteDir} s3://${websiteAssets.bucket} --recursive --exclude "*" --include "*.html" --cache-control no-cache --acl public-read`,
    triggers: [Date.now()],
  },
  { dependsOn: [syncAssetsCommand], replaceOnChanges: ['*'] }
);

const macroWebAppStack = new pulumi.StackReference('macro-web-app', {
  name: `macro-inc/macro-web-app/${stack}`,
});

export const macroWebAppBucketArn: pulumi.Output<string> = macroWebAppStack
  .getOutput('macroWebAppBucketArn')
  .apply((value) => value as string);

export const macroWebAppBucketWebsiteEndpoint: pulumi.Output<string> =
  macroWebAppStack
    .getOutput('macroWebAppBucketWebsiteEndpoint')
    .apply((value) => value as string);

export const macroWebAppRouteLambdaId: pulumi.Output<string> = macroWebAppStack
  .getOutput('appRouteLambdaId')
  .apply((value: string) => value);

export const macroWebAppRouteDomain: pulumi.Output<string> = macroWebAppStack
  .getOutput('appRouteUrl')
  .apply((url: string) => new URL(url).hostname);

export const macroOidcBucketArn: string = config.require('oidcBucketArn');
export const macroOidcBucketWebsiteEndpoint: string = config.require(
  'oidcBucketWebsiteEndpoint'
);

const wwwRedirectCode = fs
  .readFileSync('./wwwRedirect/handler.js', 'utf-8')
  .replace('__COOKIE_PREFIX__', stack === 'prod' ? '' : 'dev-');

const wwwRedirectFn = new aws.cloudfront.Function(
  `macro-wwww-redirect-fn-${stack}`,
  {
    runtime: 'cloudfront-js-2.0',
    code: wwwRedirectCode,
  }
);

const SHARED_ARRAY_RESPONSE_HEADERS_MAX_AGE_CACHE_CONTROL =
  '78ba335f-4e54-45a3-85d5-1d9933b1363d';
const SHARED_ARRAY_RESPONSE_HEADERS_NO_CACHE_CONTROL =
  'c9d6f215-ca3d-4c29-8eb4-41ee30fb2129';
const CACHING_DISABLED = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';

const securityHeadersPolicy = new aws.cloudfront.ResponseHeadersPolicy(
  `security-headers-${stack}`,
  {
    securityHeadersConfig: {
      frameOptions: {
        frameOption: 'DENY',
        override: true,
      },
      contentSecurityPolicy: {
        contentSecurityPolicy: "frame-ancestors 'none'",
        override: true,
      },
      contentTypeOptions: {
        override: true,
      },
      strictTransportSecurity: {
        accessControlMaxAgeSec: 31536000,
        includeSubdomains: false,
        preload: false,
        override: true,
      },
    },
  }
);

const compressibleCachePolicy = new aws.cloudfront.CachePolicy(
  `cache-policy-${stack}`,
  {
    parametersInCacheKeyAndForwardedToOrigin: {
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
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
  }
);

const ghostOriginId = `macro.ghost.io-${stack}`;

const cdn = new aws.cloudfront.Distribution(`cdn-${stack}`, {
  enabled: true,
  webAclId,
  tags,
  loggingConfig: {
    bucket: 'macro-cloudfront-logging.s3.amazonaws.com',
    includeCookies: false,
    prefix: `macro-website-${stack}`,
  },
  origins: [
    {
      originId: websiteAssets.arn,
      domainName: websiteAssets.websiteEndpoint,
      customOriginConfig: {
        originProtocolPolicy: 'http-only',
        httpPort: 80,
        httpsPort: 443,
        originSslProtocols: ['TLSv1.2'],
      },
    },
    {
      originId: macroWebAppBucketArn,
      domainName: macroWebAppBucketWebsiteEndpoint,
      customOriginConfig: {
        originProtocolPolicy: 'http-only',
        httpPort: 80,
        httpsPort: 443,
        originSslProtocols: ['TLSv1.2'],
      },
    },
    {
      originId: macroOidcBucketArn,
      domainName: macroOidcBucketWebsiteEndpoint,
      customOriginConfig: {
        originProtocolPolicy: 'http-only',
        httpPort: 80,
        httpsPort: 443,
        originSslProtocols: ['TLSv1.2'],
      },
    },
    {
      originId: ghostOriginId,
      domainName: 'macro-2.ghost.io',
      customHeaders: [
        {
          name: 'X-Forwarded-Host',
          value: stack === 'prod' ? domain : domainName,
        },
        {
          name: 'X-Forwarded-Proto',
          value: 'https',
        },
      ],
      customOriginConfig: {
        originProtocolPolicy: 'https-only',
        httpPort: 80,
        httpsPort: 443,
        originSslProtocols: ['TLSv1.2'],
      },
    },
    {
      originId: macroWebAppRouteLambdaId,
      domainName: macroWebAppRouteDomain,
      customOriginConfig: {
        originProtocolPolicy: 'https-only',
        httpPort: 80,
        httpsPort: 443,
        originSslProtocols: ['TLSv1.2'],
      },
    },
  ],
  defaultCacheBehavior: {
    targetOriginId: websiteAssets.arn,
    viewerProtocolPolicy: 'redirect-to-https',
    allowedMethods: ['GET', 'HEAD'],
    cachedMethods: ['GET', 'HEAD'],
    cachePolicyId: compressibleCachePolicy.id,
    responseHeadersPolicyId: securityHeadersPolicy.id,
    compress: true,
    functionAssociations: [
      {
        eventType: 'viewer-request',
        functionArn: wwwRedirectFn.arn,
      },
    ],
  },
  orderedCacheBehaviors: [
    {
      pathPattern: '/.well-known/*',
      targetOriginId: macroOidcBucketArn,
      cachePolicyId: CACHING_DISABLED,
      viewerProtocolPolicy: 'redirect-to-https',
      allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
      cachedMethods: ['GET', 'HEAD', 'OPTIONS'],
    },
    {
      pathPattern: '/app/*@*',
      targetOriginId: macroWebAppRouteLambdaId,
      cachePolicyId: CACHING_DISABLED,
      responseHeadersPolicyId: SHARED_ARRAY_RESPONSE_HEADERS_NO_CACHE_CONTROL,
      viewerProtocolPolicy: 'redirect-to-https',
      allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
      cachedMethods: ['GET', 'HEAD', 'OPTIONS'],
    },
    {
      pathPattern: '/app/*.*',
      responseHeadersPolicyId:
        SHARED_ARRAY_RESPONSE_HEADERS_MAX_AGE_CACHE_CONTROL,
      targetOriginId: macroWebAppBucketArn,
      viewerProtocolPolicy: 'redirect-to-https',
      allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
      cachedMethods: ['GET', 'HEAD', 'OPTIONS'],
      cachePolicyId: compressibleCachePolicy.id,
      compress: true,
    },
    {
      pathPattern: '/app',
      targetOriginId: macroWebAppBucketArn,
      cachePolicyId: CACHING_DISABLED,
      responseHeadersPolicyId: SHARED_ARRAY_RESPONSE_HEADERS_NO_CACHE_CONTROL,
      viewerProtocolPolicy: 'redirect-to-https',
      allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
      cachedMethods: ['GET', 'HEAD', 'OPTIONS'],
    },
    {
      pathPattern: '/app/*',
      targetOriginId: macroWebAppRouteLambdaId,
      cachePolicyId: CACHING_DISABLED,
      responseHeadersPolicyId: SHARED_ARRAY_RESPONSE_HEADERS_NO_CACHE_CONTROL,
      viewerProtocolPolicy: 'redirect-to-https',
      allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
      cachedMethods: ['GET', 'HEAD', 'OPTIONS'],
    },
    {
      pathPattern: 'resources*',
      targetOriginId: ghostOriginId,
      viewerProtocolPolicy: 'redirect-to-https',
      allowedMethods: [
        'GET',
        'HEAD',
        'OPTIONS',
        'PUT',
        'POST',
        'PATCH',
        'DELETE',
      ],
      cachedMethods: ['GET', 'HEAD'],
      forwardedValues: {
        queryString: true,
        cookies: {
          forward: 'all',
        },
        headers: ['Origin', 'Referer', 'User-Agent'],
      },
    },
  ],
  restrictions: {
    geoRestriction: {
      restrictionType: 'none',
    },
  },
  priceClass: stack === 'prod' ? 'PriceClass_All' : 'PriceClass_100',
  aliases:
    stack === 'prod'
      ? [domainName, domain, `chat.${domain}`]
      : stack === 'dev'
        ? [domainName, `chat-${domainName}`]
        : [domainName],
  viewerCertificate: {
    cloudfrontDefaultCertificate: false,
    acmCertificateArn: certArn,
    sslSupportMethod: 'sni-only',
    minimumProtocolVersion: 'TLSv1.2_2021',
  },
});

new aws.route53.Record(domainName, {
  name: subdomain,
  zoneId: zone.zoneId,
  type: 'A',
  aliases: [
    {
      name: cdn.domainName,
      zoneId: cdn.hostedZoneId,
      evaluateTargetHealth: true,
    },
  ],
});

if (stack === 'prod') {
  new aws.route53.Record(domain, {
    name: domain,
    zoneId: zone.zoneId,
    type: 'A',
    aliases: [
      {
        name: cdn.domainName,
        zoneId: cdn.hostedZoneId,
        evaluateTargetHealth: true,
      },
    ],
  });

  new aws.route53.Record('chat', {
    name: 'chat',
    zoneId: zone.zoneId,
    type: 'A',
    aliases: [
      {
        name: cdn.domainName,
        zoneId: cdn.hostedZoneId,
        evaluateTargetHealth: true,
      },
    ],
  });
}

if (stack === 'dev') {
  new aws.route53.Record('edge-cname', {
    name: 'edge',
    zoneId: zone.zoneId,
    type: 'CNAME',
    records: ['macro-site-solidify.pages.dev'],
    ttl: 300,
  });

  new aws.route53.Record('chat-dev', {
    name: 'chat-dev',
    zoneId: zone.zoneId,
    type: 'A',
    aliases: [
      {
        name: cdn.domainName,
        zoneId: cdn.hostedZoneId,
        evaluateTargetHealth: true,
      },
    ],
  });
}

const invalidateCache = new command.local.Command(
  'invalidate-cache',
  {
    create: pulumi.interpolate`aws cloudfront create-invalidation --distribution-id ${cdn.id} --paths "/*"`,
    triggers: [Date.now()],
  },
  {
    dependsOn: [
      cdn,
      websiteAssets,
      syncAssetsCommand,
      syncVideoAssetsCommand,
      syncBrAssetsCommand,
      syncGzAssetsCommand,
      syncIndexHtmlCommand,
    ],
    replaceOnChanges: ['*'],
  }
);

export const cacheInvalidationResult = invalidateCache.stdout;
export const websiteAssetsEndpoint = websiteAssets.websiteEndpoint;
export const websiteAssetsDomain = websiteAssets.bucketDomainName;
export const cdnId = cdn.id;
export const cdnURL = pulumi.interpolate`https://${cdn.domainName}`;
export const domainURL = `https://${domainName}`;
