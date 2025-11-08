import * as aws from '@pulumi/aws';
import type * as pulumi from '@pulumi/pulumi';
import { stack } from '@shared';

const MACRO_API_TOKEN_PUBLIC_KEY = `macro-api-token-public-key-${stack}`;

export function getMacroApiToken(): {
  macroApiTokenIssuer: string;
  macroApiTokenPublicKey: string;
  macroApiTokenPublicKeyArn: pulumi.Output<string>;
} {
  return {
    macroApiTokenIssuer:
      stack === 'prod'
        ? 'authentication-service.macro.com'
        : `authentication-service-${stack}.macro.com`,
    macroApiTokenPublicKey: MACRO_API_TOKEN_PUBLIC_KEY,
    macroApiTokenPublicKeyArn: aws.secretsmanager
      .getSecretVersionOutput({
        secretId: MACRO_API_TOKEN_PUBLIC_KEY,
      })
      .apply((secret) => secret.arn),
  };
}
