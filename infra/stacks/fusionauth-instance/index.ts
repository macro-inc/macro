import {
  FusionAuthApplication,
  FusionAuthEMail,
  FusionAuthKey,
  FusionAuthLambda,
  FusionAuthReactor,
  FusionAuthSystemConfiguration,
  FusionAuthTenant,
  FusionAuthWebhook,
} from 'pulumi-fusionauth';
import * as pulumi from '@pulumi/pulumi';
import * as fs from 'fs';
import { config, stack } from '../../packages/shared';

import 'dotenv/config';
import {
  AUTHENTICATION_SERVICE_INTERNAL_SECRET,
  AUTHENTICATION_SERVICE_DOMAIN,
  DEFAULT_FUSIONAUTH_TENANT_ID,
  FUSIONAUTH_APPLICATION_CLIENT_ID,
  FUSIONAUTH_CLIENT_SECRET,
  FUSIONAUTH_ISSUER,
  FUSIONAUTH_SIGNING_KEY_ID,
  fusionAuthProvider,
  FUSIONAUTH_LICENSE_KEY,
  SMTP_CREDENTIALS,
} from './constants';
import { ALLOWED_ORIGINS } from './origins';

// The main fusionauth provider, this will be passed around when creating various components

// Give access to premium features
new FusionAuthReactor(
  'reactor',
  {
    licenseId: pulumi.interpolate`${FUSIONAUTH_LICENSE_KEY}`,
  },
  { provider: fusionAuthProvider }
);

// CORS configuration
new FusionAuthSystemConfiguration(
  'system-config',
  {
    corsConfiguration: {
      allowedOrigins: ['https://appleid.apple.com'],
      allowedMethods: ['POST'],
      allowCredentials: true,
      enabled: true,
      preflightMaxAgeInSeconds: 1800,
    },
  },
  { provider: fusionAuthProvider }
);

// Passwordless login email template
const passwordlessEmailTemplate = new FusionAuthEMail(
  'passwordless-email-template',
  {
    name: 'Passwordless Login',
    defaultSubject: 'Log into Macro',
    defaultHtmlTemplate: fs.readFileSync(
      './templates/passwordless_email_template.html',
      'utf-8'
    ),
    defaultTextTemplate: 'Your login code is: ${code}',
    defaultFromName: 'Macro',
  },
  { provider: fusionAuthProvider }
);

// Email verification template
const emailVerificationTemplate = new FusionAuthEMail(
  'email-verification-template',
  {
    name: 'Email Verification',
    defaultSubject: 'Verify your Macro email',
    defaultHtmlTemplate: fs
      .readFileSync('./templates/email_verification_template.html', 'utf-8')
      .replaceAll('{{AUTH_SERVICE_URL}}', AUTHENTICATION_SERVICE_DOMAIN),
    defaultTextTemplate:
      'Please verify your email by visiting: ${verificationId}',
    defaultFromName: 'Macro',
  },
  { provider: fusionAuthProvider }
);

// Webhooks
new FusionAuthWebhook(
  'create-user-webhook',
  {
    description: 'Create User Webhook',
    connectTimeout: 1000,
    readTimeout: 2000,
    url: `${AUTHENTICATION_SERVICE_DOMAIN}/webhooks/user`,
    global: true,
    eventsEnabled: {
      userCreate: true,
      userCreateComplete: true,
      userEmailVerified: true,
    },
    headers: {
      'x-internal-auth-key': pulumi.interpolate`${AUTHENTICATION_SERVICE_INTERNAL_SECRET}`,
    },
  },
  { provider: fusionAuthProvider }
);

new FusionAuthWebhook(
  'delete-user-webhook',
  {
    description: 'Delete User Webhook',
    connectTimeout: 1000,
    readTimeout: 2000,
    url: `${AUTHENTICATION_SERVICE_DOMAIN}/webhooks/user/delete`,
    global: true,
    eventsEnabled: {
      userDeleteComplete: true,
    },
    headers: {
      'x-internal-auth-key': pulumi.interpolate`${AUTHENTICATION_SERVICE_INTERNAL_SECRET}`,
    },
  },
  { provider: fusionAuthProvider }
);

// Default tenant with email configuration
const defaultTenant = new FusionAuthTenant(
  'default-tenant',
  {
    tenantId: DEFAULT_FUSIONAUTH_TENANT_ID,
    name: 'Default Tenant - DO NOT TOUCH',
    issuer: FUSIONAUTH_ISSUER,
    emailConfiguration: {
      host: 'email-smtp.us-east-1.amazonaws.com',
      port: 587,
      username: SMTP_CREDENTIALS.username,
      password: SMTP_CREDENTIALS.password,
      security: 'TLS',
      defaultFromEmail: config.require('default-from-email'),
      defaultFromName: 'Macro',
      implicitEmailVerificationAllowed: true,
      passwordlessEmailTemplateId: passwordlessEmailTemplate.id,
      // Email Verification
      verifyEmail: true,
      verifyEmailWhenChanged: true,
      verificationEmailTemplateId: emailVerificationTemplate.id,
      verificationStrategy: 'ClickableLink',
    },
    // Delete unverified users
    userDeletePolicy: {
      unverifiedEnabled: true,
      unverifiedNumberOfDaysToRetain: 30,
    },
    eventConfigurations: [
      {
        enabled: true,
        event: 'user.create',
        transactionType: 'AbsoluteMajority',
      },
      {
        enabled: true,
        event: 'user.create.complete',
        transactionType: 'None',
      },
      {
        enabled: true,
        event: 'user.delete.complete',
        transactionType: 'None',
      },
      {
        enabled: true,
        event: 'user.email.verified',
        transactionType: 'AbsoluteMajority',
      },
    ],
    externalIdentifierConfiguration: {
      passwordlessLoginGenerator: {
        length: 6,
        type: 'randomDigits',
      },
    },
  },
  { provider: fusionAuthProvider }
);

export const defaultTenantId = defaultTenant.tenantId;

// Lambda
const populateLambdaBody = pulumi
  .output(AUTHENTICATION_SERVICE_INTERNAL_SECRET)
  .apply((secret) =>
    fs
      .readFileSync('./templates/populate_jwt.js', 'utf-8')
      .replaceAll('{{AUTH_SERVICE_URL}}', AUTHENTICATION_SERVICE_DOMAIN)
      .replaceAll('{{INTERNAL_SECRET}}', secret)
  );

const populateJwtLambda = new FusionAuthLambda(
  'populate-jwt-lambda',
  {
    lambdaId: 'a7f3e8d2-4b91-4c5a-9e6f-1a2b3c4d5e6f', // had to give a manual uuid so the application lambdaConfiguration works
    name: 'populate_macro_jwt',
    type: 'JWTPopulate',
    debug: stack === 'local',
    body: pulumi.interpolate`${populateLambdaBody}`,
  },
  { provider: fusionAuthProvider }
);

export const populateJwtLambdaId = populateJwtLambda.lambdaId;

// Custom signing key for application
const signingKey = new FusionAuthKey(
  'jwt-signing-key',
  {
    keyId: FUSIONAUTH_SIGNING_KEY_ID,
    algorithm: 'HS256',
    name: 'JWT Signing Key',
  },
  { provider: fusionAuthProvider }
);

export const signingKeyId = signingKey.keyId;

const macroApplication = new FusionAuthApplication(
  'macro-application',
  {
    name: 'Macro',
    tenantId: defaultTenant.tenantId,
    applicationId: FUSIONAUTH_APPLICATION_CLIENT_ID,
    authenticationTokenConfigurationEnabled: false,
    loginConfiguration: {
      allowTokenRefresh: true,
      requireAuthentication: true,
      generateRefreshTokens: true,
    },
    passwordlessConfigurationEnabled: true,
    lambdaConfiguration: {
      accessTokenPopulateId: populateJwtLambda.lambdaId,
    },
    jwtConfiguration: {
      enabled: true,
      // signing key id for access token
      accessTokenId: signingKey.keyId,
      // signing key id for id token
      idTokenKeyId: signingKey.keyId,
      ttlSeconds: 3600,
      refreshTokenExpirationPolicy: 'SlidingWindow',
      refreshTokenTtlMinutes: 43200,
    },
    oauthConfiguration: {
      clientId: FUSIONAUTH_APPLICATION_CLIENT_ID,
      clientSecret:
        FUSIONAUTH_CLIENT_SECRET &&
        pulumi.interpolate`${FUSIONAUTH_CLIENT_SECRET}`,
      generateRefreshTokens: true,
      clientAuthenticationPolicy: 'Required',
      proofKeyForCodeExchangePolicy: 'NotRequired',
      scopeHandlingPolicy: 'Compatibility',
      unknownScopePolicy: 'Remove',
      authorizedUrlValidationPolicy: 'ExactMatch',
      authorizedRedirectUrls: [
        `${AUTHENTICATION_SERVICE_DOMAIN}/oauth/redirect`,
      ],
      authorizedOriginUrls: ALLOWED_ORIGINS(),
      logoutBehavior: 'AllApplications',
      enabledGrants: ['authorization_code', 'implicit', 'refresh_token'],
      relationship: 'FirstParty',
      providedScopePolicies: [
        {
          address: {
            enabled: false,
            required: false,
          },
          email: {
            enabled: true,
            required: false,
          },
          phone: {
            enabled: false,
            required: false,
          },
          profile: {
            enabled: true,
            required: false,
          },
        },
      ],
    },
  },
  { provider: fusionAuthProvider }
);

export const macroApplicationClientId =
  macroApplication.oauthConfiguration.clientId;
