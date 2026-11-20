// The local stack the differential runs against: addresses, SQL, HTTP as a
// signed-in user, and the notification ingress queue.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type Stack = {
  proxyUrl: string;
  databaseUrl: string;
  redisUrl: string;
  sqsUrl: string;
};

export function stackFromEnv(): Stack {
  const need = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set`);
    return value.replace(/\/$/, '');
  };
  return {
    proxyUrl: need('PROOF_PROXY_URL'),
    databaseUrl: need('PROOF_DATABASE_URL'),
    redisUrl: need('PROOF_REDIS_URL'),
    sqsUrl: need('PROOF_SQS_URL'),
  };
}

/** Rows of a query as JSON objects. */
export async function sql<Row = Record<string, unknown>>(
  stack: Stack,
  query: string
): Promise<Row[]> {
  const { stdout } = await run(
    'psql',
    [
      stack.databaseUrl,
      '--no-psqlrc',
      '--tuples-only',
      '--no-align',
      '--set=ON_ERROR_STOP=1',
      '--command',
      `WITH rows AS (${query}) SELECT coalesce(jsonb_agg(to_jsonb(rows)), '[]')::text FROM rows`,
    ],
    { maxBuffer: 256 * 1024 * 1024 }
  );
  return JSON.parse(stdout) as Row[];
}

/** Runs statements that return nothing. */
export async function exec(stack: Stack, statements: string): Promise<void> {
  await run(
    'psql',
    [
      stack.databaseUrl,
      '--no-psqlrc',
      '--quiet',
      '--set=ON_ERROR_STOP=1',
      '--command',
      statements,
    ],
    { maxBuffer: 64 * 1024 * 1024 }
  );
}

export async function execFileSql(stack: Stack, file: string): Promise<void> {
  await run(
    'psql',
    [stack.databaseUrl, '--no-psqlrc', '--quiet', '--set=ON_ERROR_STOP=1', '-f', file],
    { maxBuffer: 64 * 1024 * 1024 }
  );
}

export const q = (value: string) => `'${value.replaceAll("'", "''")}'`;

export type User = {
  key: string;
  email: string;
  macroUserId: string;
  cookie: string;
  token: string;
};

export class HttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly path: string;
  constructor(status: number, body: string, path: string) {
    super(`${path}: ${status} ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

export async function call<T = unknown>(
  stack: Stack,
  user: User | undefined,
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<T> {
  const response = await fetch(`${stack.proxyUrl}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(user ? { cookie: user.cookie, authorization: `Bearer ${user.token}` } : {}),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    redirect: 'manual',
  });
  const text = await response.text();
  if (!response.ok) throw new HttpError(response.status, text, path);
  return (text ? JSON.parse(text) : undefined) as T;
}

async function clearSignUpCounters(stack: Stack) {
  await run('redis-cli', ['-u', stack.redisUrl, '--scan', '--pattern', '*sign*up*']).then(
    async ({ stdout }) => {
      const keys = stdout.split('\n').filter(Boolean);
      if (keys.length) await run('redis-cli', ['-u', stack.redisUrl, 'DEL', ...keys]);
    },
    () => undefined
  );
}

/** Passwordless sign-in, as the email end-to-end harness does it. */
export async function signIn(stack: Stack, key: string, email: string): Promise<User> {
  await clearSignUpCounters(stack);
  const start = await fetch(`${stack.proxyUrl}/auth/login/passwordless`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, redirect_uri: `${stack.proxyUrl}/app` }),
  });
  if (!start.ok) throw new Error(`${key}: passwordless start ${start.status} ${await start.text()}`);
  const { code } = (await start.json()) as { code: string };
  const done = await fetch(
    `${stack.proxyUrl}/auth/oauth/passwordless/${code}?email=${encodeURIComponent(email)}`,
    { redirect: 'manual' }
  );
  const setCookies = done.headers.getSetCookie();
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  const token = /access-token=([^;]+)/.exec(cookie)?.[1];
  if (done.status !== 303 || !token) {
    throw new Error(`${key} could not sign in (${done.status}): ${await done.text()}`);
  }
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as {
    macro_user_id: string;
  };
  const user: User = { key, email, macroUserId: claims.macro_user_id, cookie, token };
  await call(stack, user, '/auth/user/tutorial', {
    method: 'PATCH',
    body: { tutorialComplete: true },
  }).catch(() => undefined);
  return user;
}

/** Sends one message to an SQS queue of the local stack (query protocol). */
export async function sqsSend(queueUrl: string, body: unknown): Promise<void> {
  const form = new URLSearchParams({
    Action: 'SendMessage',
    MessageBody: JSON.stringify(body),
    Version: '2012-11-05',
  });
  const response = await fetch(queueUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization:
        'AWS4-HMAC-SHA256 Credential=test/20240101/us-east-1/sqs/aws4_request, SignedHeaders=host, Signature=0',
    },
    body: form,
  });
  if (!response.ok) throw new Error(`SQS SendMessage ${response.status}: ${await response.text()}`);
}
