import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import type * as tls from '@pulumi/tls';
import { stack } from '@shared';

// cloudfront distribution in front of attachment bucket. needed so we can set custom Cross-Origin-Resource-Policy
// header on bucket items so we can display images inline in emails

export const tags = {
  environment: stack,
  tech_lead: 'evan',
  project: 'email-service',
};

const BASE_NAME = 'cf-dist-email';

export const getCloudfrontDistribution = ({
  bucket,
  keyPair,
}: {
  bucket: aws.s3.Bucket;
  keyPair: tls.PrivateKey;
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

  const responseHeadersPolicy = new aws.cloudfront.ResponseHeadersPolicy(
    `${BASE_NAME}-response-headers-policy-${stack}`,
    {
      name: `${BASE_NAME}-response-headers-policy-${stack}`,
      customHeadersConfig: {
        items: [
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

  const distribution = new aws.cloudfront.Distribution(
    `${BASE_NAME}-distribution-${stack}`,
    {
      comment: `(${stack}) S3 signed URL distribution for email attachments`,
      viewerCertificate: {
        cloudfrontDefaultCertificate: true,
      },
      loggingConfig:
        stack === 'prod'
          ? {
              bucket: 'macro-cloudfront-logging.s3.amazonaws.com',
              includeCookies: false,
              prefix: `email-attachments-${stack}`,
            }
          : undefined,
      defaultCacheBehavior: {
        allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
        cachedMethods: ['GET', 'HEAD', 'OPTIONS'],
        compress: true,
        targetOriginId: bucket.id,
        viewerProtocolPolicy: 'https-only',
        trustedKeyGroups: [cloudFrontKeyGroup.id],
        responseHeadersPolicyId,
        forwardedValues: {
          queryString: false,
          cookies: {
            forward: 'none',
          },
        },
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

  return {
    distribution,
    domain: pulumi.interpolate`https://${distribution.domainName}`,
    publicKey: cloudFrontPublicKey,
  };
};

export const cloudfrontPrivateKeySecret = ({
  secretName,
  keyPair,
}: {
  secretName: string;
  keyPair: tls.PrivateKey;
}) => {
  const privateKeySecret = new aws.secretsmanager.Secret(
    `${BASE_NAME}-private-key-secret-${stack}`,
    {
      name: secretName,
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

  return privateKeySecret;
};
