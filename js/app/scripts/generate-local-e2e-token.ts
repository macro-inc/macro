#!/usr/bin/env bun
import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const DEFAULT_EXPIRY_SECONDS = 8 * 60 * 60;

type LocalE2EManifest = {
  user?: {
    email?: string;
  };
};

type LocalE2EUser = {
  macro_user_id: string;
  fusion_user_id?: string;
  user_id: string;
  email: string;
};

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function parseDotEnv(contents: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value.replaceAll('\\n', '\n');
  }

  return env;
}

function findUp(startDir: string, relativePath: string): string | undefined {
  let current = resolve(startDir);

  while (true) {
    const candidate = join(current, relativePath);
    if (existsSync(candidate)) return candidate;

    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function findEnvFile(startDir: string): string | undefined {
  return findUp(startDir, '.env');
}

function findLocalE2ESeedFile(
  startDir: string,
  fileName: string
): string | undefined {
  return findUp(startDir, `rust/cloud-storage/seed_cli/seed/local_e2e/${fileName}`);
}

function readJson<T>(path: string | undefined, fallback: T): T {
  if (!path) return fallback;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function readManifest(): LocalE2EManifest {
  return readJson(
    findLocalE2ESeedFile(process.cwd(), 'manifest.json'),
    {}
  );
}

function readUsers(): LocalE2EUser[] {
  return readJson(findLocalE2ESeedFile(process.cwd(), 'users.json'), []);
}

function readEnv(): Record<string, string> {
  const envPath = findEnvFile(process.cwd());
  const fileEnv = envPath ? parseDotEnv(readFileSync(envPath, 'utf8')) : {};
  return { ...fileEnv, ...process.env } as Record<string, string>;
}

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1) return process.argv[index + 1];

  return undefined;
}

const env = readEnv();
const manifest = readManifest();
const users = readUsers();
const email = readArg('email') ?? manifest.user?.email ?? 'e2e@macro.local';
const seedUser = users.find((user) => user.email === email);
const macroUserId = readArg('macro-user-id') ?? seedUser?.user_id ?? `macro|${email}`;
const fusionUserId =
  readArg('fusion-user-id') ??
  seedUser?.fusion_user_id ??
  seedUser?.macro_user_id ??
  '00000000-0000-0000-0003-000000000001';
const issuer = readArg('issuer') ?? env.MACRO_API_TOKEN_ISSUER ?? 'local';
const expirySeconds = Number(
  readArg('expiry-seconds') ??
    env.MACRO_API_TOKEN_EXPIRY_SECONDS ??
    DEFAULT_EXPIRY_SECONDS
);
const organizationId = readArg('organization-id');
const privateKey = env.MACRO_API_TOKEN_PRIVATE_SECRET_KEY;

if (!Number.isFinite(expirySeconds) || expirySeconds <= 0) {
  throw new Error(`expiry-seconds must be a positive number, got ${expirySeconds}`);
}

if (!privateKey) {
  throw new Error(
    'MACRO_API_TOKEN_PRIVATE_SECRET_KEY is required. Run `just get_environment` and local FusionAuth env patching first, or export it explicitly.'
  );
}

const now = Math.floor(Date.now() / 1000);
const header = {
  alg: 'RS256',
  kid: 'macro',
  typ: 'JWT',
};
const payload: Record<string, string | number> = {
  exp: now + expirySeconds,
  iss: issuer,
  fusion_user_id: fusionUserId,
  macro_user_id: macroUserId,
};

if (organizationId !== undefined) {
  const parsedOrganizationId = Number(organizationId);
  if (!Number.isInteger(parsedOrganizationId)) {
    throw new Error(`organization-id must be an integer, got ${organizationId}`);
  }
  payload.macro_organization_id = parsedOrganizationId;
}

const encodedHeader = base64Url(JSON.stringify(header));
const encodedPayload = base64Url(JSON.stringify(payload));
const signingInput = `${encodedHeader}.${encodedPayload}`;
const signature = createSign('RSA-SHA256')
  .update(signingInput)
  .sign(privateKey);

console.log(`${signingInput}.${base64Url(signature)}`);
