#!/usr/bin/env bun
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import * as jose from "jose";
import { parseArgs } from "util";

const HELP = `Generate JWT tokens for authentication using AWS Secrets Manager.

Usage:
  bun scripts/generate-jwt-from-secrets.ts [options]

Options:
  --email EMAIL           Email address (default: gab@macro.com)
  --env ENV               Environment: dev or prod (default: dev)
  --expiry MINUTES        Token expiry in minutes (default: 480)
  --output FORMAT         Output format: cookies, json, or env (default: cookies)
  --fusion-user-id ID     FusionAuth user ID (auto-generated if not provided)
  --organization-id ID    Organization ID (optional)
  --help                  Show this help message
`;

// Configuration per environment
const ENV_CONFIG = {
  dev: {
    jwtSecretKey: "fusionauth-jwt-secret-dev",
    macroApiTokenPrivateKey: "macro-api-token-private-key-dev",
    fusionauthClientId: "fusionauth-client-id-key-dev",
    issuer: "fusionauth-dev.macro.com",
    macroApiTokenIssuer: "authentication-service-dev.macro.com",
    accessTokenCookie: "dev-macro-access-token",
    refreshTokenCookie: "dev-macro-refresh-token",
    tid: "tenant-dev",
  },
  prod: {
    jwtSecretKey: "fusionauth-jwt-secret-prod",
    macroApiTokenPrivateKey: "macro-api-token-private-key-prod",
    fusionauthClientId: "fusionauth-client-id-key-prod",
    issuer: "auth.macro.com",
    macroApiTokenIssuer: "authentication-service.macro.com",
    accessTokenCookie: "macro-access-token",
    refreshTokenCookie: "macro-refresh-token",
    tid: "tenant-prod",
  },
} as const;

type Environment = keyof typeof ENV_CONFIG;

// AWS Secrets Manager client
const secretsManager = new SecretsManagerClient({ region: "us-east-1" });

async function getSecret(secretName: string): Promise<string> {
  try {
    const command = new GetSecretValueCommand({ SecretId: secretName });
    const response = await secretsManager.send(command);
    if (!response.SecretString) {
      throw new Error(`Secret ${secretName} has no string value`);
    }
    return response.SecretString;
  } catch (error) {
    console.error(`Error fetching secret '${secretName}':`, error);
    process.exit(1);
  }
}

async function generateAccessToken(params: {
  email: string;
  jwtSecret: string;
  audience: string;
  issuer: string;
  tid: string;
  expiryMinutes: number;
  fusionUserId: string;
  organizationId?: number;
}): Promise<string> {
  const {
    email,
    jwtSecret,
    audience,
    issuer,
    tid,
    expiryMinutes,
    fusionUserId,
    organizationId,
  } = params;

  const macroUserId = `macro|${email}`;

  const payload: Record<string, unknown> = {
    aud: audience,
    tid: tid,
    iss: issuer,
    email: email,
    fusion_user_id: fusionUserId,
    macro_user_id: macroUserId,
  };

  if (organizationId !== undefined) {
    payload.macro_organization_id = organizationId;
  }

  // Create the secret key for HS256
  const secretKey = new TextEncoder().encode(jwtSecret);

  const token = await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", kid: "fromFusionauth" })
    .setExpirationTime(`${expiryMinutes}m`)
    .sign(secretKey);

  return token;
}

async function generateMacroApiToken(params: {
  email: string;
  privateKey: string;
  issuer: string;
  expiryMinutes: number;
  fusionUserId: string;
  organizationId?: number;
}): Promise<string> {
  const { email, privateKey, issuer, expiryMinutes, fusionUserId, organizationId } =
    params;

  const macroUserId = `macro|${email}`;

  const payload: Record<string, unknown> = {
    iss: issuer,
    fusion_user_id: fusionUserId,
    macro_user_id: macroUserId,
  };

  if (organizationId !== undefined) {
    payload.macro_organization_id = organizationId;
  }

  // Import the RSA private key - handle both PKCS#8 and RSA PRIVATE KEY formats
  let rsaPrivateKey: jose.KeyLike;

  if (privateKey.includes("-----BEGIN PRIVATE KEY-----")) {
    // PKCS#8 format
    rsaPrivateKey = await jose.importPKCS8(privateKey, "RS256");
  } else if (privateKey.includes("-----BEGIN RSA PRIVATE KEY-----")) {
    // Traditional RSA format - need to use crypto for this
    const crypto = await import("crypto");
    const keyObject = crypto.createPrivateKey(privateKey);
    rsaPrivateKey = keyObject as jose.KeyLike;
  } else {
    throw new Error(
      "Private key must be in PEM format (PKCS#8 or RSA PRIVATE KEY)"
    );
  }

  const token = await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "macro" })
    .setExpirationTime(`${expiryMinutes}m`)
    .sign(rsaPrivateKey);

  return token;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      email: {
        type: "string",
        default: "gab@macro.com",
      },
      env: {
        type: "string",
        default: "dev",
      },
      expiry: {
        type: "string",
        default: "480",
      },
      output: {
        type: "string",
        default: "cookies",
      },
      "fusion-user-id": {
        type: "string",
      },
      "organization-id": {
        type: "string",
      },
      help: {
        type: "boolean",
        default: false,
      },
    },
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const env = values.env as Environment;
  if (!ENV_CONFIG[env]) {
    console.error(`Invalid environment: ${env}. Must be 'dev' or 'prod'.`);
    process.exit(1);
  }

  const config = ENV_CONFIG[env];
  const email = values.email!;
  const expiryMinutes = parseInt(values.expiry!, 10);
  const output = values.output as "cookies" | "json" | "env";
  const macroUserId = `macro|${email}`;
  const fusionUserId = values["fusion-user-id"] ?? crypto.randomUUID();
  const organizationId = values["organization-id"]
    ? parseInt(values["organization-id"], 10)
    : undefined;

  console.error(`Fetching secrets for ${env} environment...`);

  // Fetch secrets from AWS
  const [jwtSecret, privateKey, audience] = await Promise.all([
    getSecret(config.jwtSecretKey),
    getSecret(config.macroApiTokenPrivateKey),
    getSecret(config.fusionauthClientId),
  ]);

  console.error(`Generating tokens for: ${email}`);

  // Generate tokens
  const accessToken = await generateAccessToken({
    email,
    jwtSecret,
    audience,
    issuer: config.issuer,
    tid: config.tid,
    expiryMinutes,
    fusionUserId,
    organizationId,
  });

  const macroApiToken = await generateMacroApiToken({
    email,
    privateKey,
    issuer: config.macroApiTokenIssuer,
    expiryMinutes,
    fusionUserId,
    organizationId,
  });

  // Calculate expiry time
  const expiryTime = new Date(Date.now() + expiryMinutes * 60 * 1000);

  if (output === "json") {
    const result = {
      access_token: accessToken,
      macro_api_token: macroApiToken,
      access_token_cookie_name: config.accessTokenCookie,
      email,
      macro_user_id: macroUserId,
      fusion_user_id: fusionUserId,
      expires_at: expiryTime.toISOString(),
      environment: env,
    };
    console.log(JSON.stringify(result, null, 2));
  } else if (output === "env") {
    console.log(`export MACRO_ACCESS_TOKEN='${accessToken}'`);
    console.log(`export MACRO_API_TOKEN='${macroApiToken}'`);
  } else {
    // Default: simple output with browser command and curl
    const serviceSuffix = env === "prod" ? "" : "-dev";
    const cookieExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();

    console.log(`\nBrowser console:`);
    console.log(
      `document.cookie = '${config.accessTokenCookie}=${accessToken}; domain=.macro.com; path=/; expires=${cookieExpiry}; SameSite=None; Secure';`
    );

    console.log(`\nCurl:`);
    console.log(
      `curl -H 'Authorization: Bearer ${accessToken}' https://auth-service${serviceSuffix}.macro.com/user/me`
    );
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
