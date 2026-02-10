import { config, stack } from '../../packages/shared';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { Provider } from 'pulumi-fusionauth';

// The id of the default tenant
export const DEFAULT_FUSIONAUTH_TENANT_ID =
  stack === 'local'
    ? undefined
    : config.require('fusionauth-default-tenant-id');

// The fusionauth issuer on the tenant
export const FUSIONAUTH_ISSUER = config.require('fusionauth-issuer');

// The pre-existing application id
// This is only predefined fro existing infra (dev and prod)
export const FUSIONAUTH_APPLICATION_CLIENT_ID =
  stack === 'local' ? undefined : config.require('fusionauth-client-id');

export const FUSIONAUTH_SIGNING_KEY_ID = config.require(
  'fusionauth-signing-key-id'
);

// The potential pre-defined client secret for the fusionauth application
// This is only predefined for existing infra (dev and prod)
export const FUSIONAUTH_CLIENT_SECRET =
  stack === 'local'
    ? undefined
    : aws.secretsmanager
        .getSecretVersionOutput({
          secretId: config.require('fusionauth-client-secret-key'),
        })
        .apply((secret) => secret.secretString);

// The auth service url
export const AUTHENTICATION_SERVICE_DOMAIN = config.require(
  'authentication-service-domain'
);

if (AUTHENTICATION_SERVICE_DOMAIN.endsWith('/')) {
  throw new Error(
    'Cannot have authentication service domain end with trailing /'
  );
}

// The auth service internal secret
export const AUTHENTICATION_SERVICE_INTERNAL_SECRET = config.get(
  'authentication-service-internal-secret-key'
)
  ? aws.secretsmanager
      .getSecretVersionOutput({
        secretId: config.require('authentication-service-internal-secret-key'),
      })
      .apply((secret) => secret.secretString)
  : 'local';

// Fusionauth license key grabbed from aws secrets manager
export const FUSIONAUTH_LICENSE_KEY = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('fusionauth-license-key-secret-key'),
  })
  .apply((secret) => secret.secretString);

// SMTP credentials grabbed by aws secrets manager
// Stored as {username: "", password: ""}
export const SMTP_CREDENTIALS = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('smtp-user-secret-key'),
  })
  .apply(
    (secret) =>
      JSON.parse(secret.secretString) as { username: string; password: string }
  );

// This is required when importing the pre-existing fusionauth tenant into the configuration
const fusionauthConfig = new pulumi.Config('fusionauth');
const fusionauthHost = fusionauthConfig.require('host');
const fusionauthApiKey =
  stack === 'local'
    ? fusionauthConfig.requireSecret('apiKey')
    : fusionauthConfig.requireSecret('apiKey');

export const fusionAuthProvider = new Provider('fusion-auth-provider', {
  host: fusionauthHost,
  apiKey: fusionauthApiKey,
});
