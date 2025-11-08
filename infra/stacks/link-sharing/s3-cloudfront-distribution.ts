import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import * as tls from '@pulumi/tls';
import { BASE_DOMAIN, MACRO_SUBDOMAIN_CERT, stack } from '@shared';
import type { GetStorageBucketResult } from './file-storage-bucket';

export const tags = {
  environment: stack,
  tech_lead: 'gab',
  project: 'link-sharing',
};

const BASE_NAME = 'cf-dist-s3-sign';

export const getCloudfrontDistribution = ({
  bucket,
  privateKeySecretName,
}: {
  bucket: pulumi.Output<GetStorageBucketResult>;
  privateKeySecretName: string;
}) => {
  /* KEY PAIR GENERATION INFO
   *
   * Manual key pair generation
   * private key: openssl genrsa -traditional -out private.key 2048
   * public key : openssl rsa -in private.key -pubout -out public.key
   *
   *
   * Automatic rotation with pulumi
   * pulumi up --replace urn:pulumi:dev::link-sharing::tls:index/privateKey:PrivateKey::{tls private key resource name}
   */
  const keyPair = new tls.PrivateKey(`${BASE_NAME}-key-pair-${stack}`, {
    algorithm: 'RSA',
    rsaBits: 2048,
  });

  const privateKeySecret = new aws.secretsmanager.Secret(
    `${BASE_NAME}-private-key-secret-${stack}`,
    {
      name: privateKeySecretName,
      tags,
    }
  );

  new aws.secretsmanager.SecretVersion(
    `${BASE_NAME}-private-key-secret-version-${stack}`,
    {
      secretId: privateKeySecret.id,
      secretString: keyPair.privateKeyPem,
    }
  );

  const cloudFrontPublicKey = new aws.cloudfront.PublicKey(
    `${BASE_NAME}-public-key-${stack}`,
    {
      encodedKey: keyPair.publicKeyPem,
    }
  );

  const cloudFrontKeyGroup = new aws.cloudfront.KeyGroup(
    `${BASE_NAME}-key-group-${stack}`,
    {
      items: [cloudFrontPublicKey.id],
    }
  );

  const webAclId = aws.wafv2
    .getWebAcl({
      name: 'macro-global-web-acl',
      scope: 'CLOUDFRONT',
    })
    .then((r) => r.arn);

  const cachePolicy = new aws.cloudfront.CachePolicy(
    `${BASE_NAME}-cache-policy-${stack}`,
    {
      defaultTtl: 86400,
      minTtl: 1,
      maxTtl: 31536000,
      parametersInCacheKeyAndForwardedToOrigin: {
        cookiesConfig: {
          cookieBehavior: 'none',
        },
        headersConfig: {
          headerBehavior: 'whitelist',
          headers: {
            items: [
              'Origin',
              'Access-Control-Request-Method',
              'Access-Control-Request-Headers',
            ],
          },
        },
        queryStringsConfig: {
          queryStringBehavior: 'whitelist',
          queryStrings: {
            items: ['Signature'],
          },
        },
      },
    }
  );

  const originRequestPolicyId = aws.cloudfront
    .getOriginRequestPolicy({
      name: 'Managed-CORS-S3Origin',
    })
    .then((r) => r.id!);

  const responseHeadersPolicy = new aws.cloudfront.ResponseHeadersPolicy(
    `${BASE_NAME}-response-headers-policy-${stack}`,
    {
      name: `${BASE_NAME}-response-headers-policy-${stack}`,
      corsConfig: {
        accessControlAllowOrigins: { items: ['*'] },
        accessControlAllowHeaders: { items: ['*'] },
        accessControlAllowMethods: {
          items: ['ALL'],
        },
        accessControlMaxAgeSec: 300,
        accessControlAllowCredentials: false,
        originOverride: true,
      },
      securityHeadersConfig: {
        referrerPolicy: {
          referrerPolicy: 'strict-origin-when-cross-origin',
          override: false,
        },
        xssProtection: {
          modeBlock: true,
          protection: true,
          override: false,
        },
        strictTransportSecurity: {
          accessControlMaxAgeSec: 31536000,
          includeSubdomains: false,
          preload: false,
          override: false,
        },
        contentTypeOptions: {
          override: true,
        },
        frameOptions: {
          frameOption: 'SAMEORIGIN',
          override: false,
        },
      },
      customHeadersConfig: {
        items: [
          {
            header: 'Cache-Control',
            value: 'max-age=31536000',
            override: true,
          },
          {
            header: 'Cross-Origin-Resource-Policy',
            value: 'cross-origin',
            override: true,
          },
        ],
      },
    }
  );

  const responseHeadersPolicyId = responseHeadersPolicy.id;

  const originAccessControl = new aws.cloudfront.OriginAccessControl(
    `cf-dist-s3-origin-access-control-${stack}`,
    {
      originAccessControlOriginType: 's3',
      signingBehavior: 'always',
      signingProtocol: 'sigv4',
    }
  );

  // Doing this manually because for some reason bucket.bucketRegionalDomainName is not adding the region specifier
  // Apparently this is prevents redirects but the pulumi linked AWS forum post is not available
  const bucketRegionalDomainName = pulumi.interpolate`${bucket.bucket}.s3.${bucket.region}.amazonaws.com`;

  const alias = `location${stack === 'prod' ? '' : `-${stack}`}.${BASE_DOMAIN}`;
  const distribution = new aws.cloudfront.Distribution(
    `${BASE_NAME}-distribution-${stack}`,
    {
      comment: `(${stack}) S3 signed URL distribution for link sharing`,
      aliases: [alias],
      viewerCertificate: {
        cloudfrontDefaultCertificate: false,
        acmCertificateArn: MACRO_SUBDOMAIN_CERT,
        sslSupportMethod: 'sni-only',
        minimumProtocolVersion: 'TLSv1.2_2021',
      },
      loggingConfig:
        stack === 'prod'
          ? {
              bucket: 'macro-cloudfront-logging.s3.amazonaws.com',
              includeCookies: false,
              prefix: `presigned-url-${stack}`,
            }
          : undefined,
      webAclId,
      defaultCacheBehavior: {
        allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
        cachedMethods: ['GET', 'HEAD', 'OPTIONS'],
        compress: true,
        targetOriginId: bucket.id,
        viewerProtocolPolicy: 'https-only',
        trustedKeyGroups: [cloudFrontKeyGroup.id],
        cachePolicyId: cachePolicy.id,
        originRequestPolicyId,
        responseHeadersPolicyId,
      },
      enabled: true,
      origins: [
        {
          domainName: bucketRegionalDomainName,
          originId: bucket.id,
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
  const zone = aws.route53.getZoneOutput({ name: BASE_DOMAIN });
  new aws.route53.Record(BASE_DOMAIN, {
    name: `location${stack === 'prod' ? '' : `-${stack}`}`,
    zoneId: zone.zoneId,
    type: 'A',
    aliases: [
      {
        name: distribution.domainName,
        zoneId: distribution.hostedZoneId,
        evaluateTargetHealth: true,
      },
    ],
  });

  return {
    distribution,
    domain: `https://${alias}`,
    publicKey: cloudFrontPublicKey,
    privateKeySecret,
  };
};
