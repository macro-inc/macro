// Local demo provisioning only. The browser never receives an access/refresh token.
import http from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';

process.umask(0o077);
const { values } = parseArgs({
  options: {
    owner: { type: 'string' },
    output: { type: 'string', default: '.claude-cloud/credentials.json' },
    'oauth-file': { type: 'string' },
    environment: { type: 'string' },
  },
});
if (!values.owner || !/^[^\s@|]+@[^\s@|]+$/.test(values.owner)) {
  throw new Error(
    'Use --owner <Macro email> [--output private/path.json] [--oauth-file existing-demo-grant.json]'
  );
}
const output = resolve(values.output);
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
const parent = await lstat(dirname(output));
if (!parent.isDirectory() || parent.isSymbolicLink() || parent.mode & 0o077)
  throw new Error('Output directory must be private (0700).');
try {
  await lstat(output);
  throw new Error(
    'Output exists; refusing to replace credentials. Use a new output path.'
  );
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const clientId = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const scope = 'user:profile user:inference user:sessions:claude_code';
async function jsonRequest(url, options) {
  const response = await fetch(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(
      `Claude request failed (HTTP ${response.status}); response omitted.`
    );
  return response.json();
}

async function provision(tokens) {
  if (
    typeof tokens.access_token !== 'string' ||
    !tokens.scope?.split(' ').includes('user:sessions:claude_code')
  )
    throw new Error('Grant lacks the Claude Code sessions scope.');
  const headers = {
    Authorization: `Bearer ${tokens.access_token}`,
    'anthropic-version': '2023-06-01',
  };
  const profile = await jsonRequest(
    'https://api.anthropic.com/api/oauth/profile',
    { headers }
  );
  const organization = profile.organization?.uuid;
  if (typeof organization !== 'string')
    throw new Error('No Claude organization returned.');
  const environments = await jsonRequest(
    'https://api.anthropic.com/v1/environments',
    {
      headers: {
        ...headers,
        'x-organization-uuid': organization,
        'anthropic-beta':
          'environments-2026-03-01,environments-package-support-2025-12-09',
      },
    }
  );
  const candidates = environments.data.filter(
    (e) =>
      e.config?.type === 'cloud' &&
      e.state === 'active' &&
      !e.archived_at &&
      (!values.environment || values.environment === e.id)
  );
  if (candidates.length !== 1)
    throw new Error(
      'Need exactly one active cloud environment; specify --environment <env_id> if multiple exist.'
    );
  const acquired = tokens.acquired_at ?? Date.now();
  const expiresAt = Math.floor(acquired / 1000) + tokens.expires_in;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() / 1000)
    throw new Error('Expired grant; sign in again.');
  const credentials = {
    users: {
      [`macro|${values.owner}`]: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        expires_at: expiresAt,
        organization_id: organization,
        environment_id: candidates[0].id,
      },
    },
  };
  await writeFile(output, JSON.stringify(credentials, null, 2), {
    mode: 0o600,
    flag: 'wx',
  });
  console.log(
    'Claude connection saved privately. No cloud session has been created.'
  );
}

if (values['oauth-file']) {
  const source = await lstat(values['oauth-file']);
  if (!source.isFile() || source.isSymbolicLink() || source.mode & 0o077)
    throw new Error('OAuth source must be a private regular file (0600).');
  await provision(JSON.parse(await readFile(values['oauth-file'], 'utf8')));
} else {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  let used = false;
  let redirect;
  let auth;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'"
    );
    if (req.headers.host !== new URL(redirect).host || req.method !== 'GET') {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url, redirect);
    if (url.pathname === '/' && !used) {
      res.writeHead(302, { Location: auth.href }).end();
      return;
    }
    if (url.pathname !== '/callback' || used) {
      res.writeHead(404).end();
      return;
    }
    const returned = Buffer.from(url.searchParams.get('state') ?? '');
    if (
      returned.length !== state.length ||
      !timingSafeEqual(returned, Buffer.from(state))
    ) {
      res.writeHead(400).end('Invalid state');
      return;
    }
    used = true;
    try {
      const code = url.searchParams.get('code');
      if (!code || url.searchParams.has('error'))
        throw new Error('Consent not granted.');
      const tokens = await jsonRequest(
        'https://platform.claude.com/v1/oauth/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            code,
            client_id: clientId,
            redirect_uri: redirect,
            state,
            code_verifier: verifier,
          }),
        }
      );
      await provision({ ...tokens, acquired_at: Date.now() });
      res
        .writeHead(200, { 'Content-Type': 'text/plain' })
        .end('Claude connected for the Macro demo. You can close this tab.');
    } catch {
      process.exitCode = 1;
      console.error(
        'Claude connection failed. No credentials were printed; check consent and cloud environment access.'
      );
      res.writeHead(400).end('Connection failed. Return to the terminal.');
    } finally {
      clearTimeout(timeout);
      server.close();
    }
  });
  const timeout = setTimeout(() => {
    process.exitCode = 1;
    server.close();
    console.error('Sign-in timed out.');
  }, 20 * 60_000);
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    redirect = `http://localhost:${port}/callback`;
    auth = new URL('https://claude.com/cai/oauth/authorize');
    auth.search = new URLSearchParams({
      code: 'true',
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirect,
      scope,
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    console.log(`Complete Claude sign-in at http://localhost:${port}/`);
    if (process.platform === 'darwin')
      spawn('open', [`http://localhost:${port}/`], { stdio: 'ignore' }).on(
        'error',
        () => {}
      );
  });
}
