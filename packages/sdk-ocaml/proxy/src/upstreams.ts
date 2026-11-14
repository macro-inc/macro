/**
 * Where allowed requests go, and the credential they carry. Both come from
 * the proxy's own configuration: `--upstream <service>=<base url>` flags or a
 * JSON file, and `MACRO_API_KEY` from its environment. Hosts are never
 * written in code; README.md lists them per environment.
 */
import { z } from 'zod';
import { readJsonFile } from './http';
import type { RouterUpstream } from './router';

export type Upstream = RouterUpstream & {
  /** The base URL without a trailing slash; the operation path is appended. */
  base: string;
};

/** `{"<service>": "<base url>"}`. */
export const UpstreamsFile = z.record(z.string(), z.string());

const BASE_SEGMENT = /^[A-Za-z0-9\-._~]+$/;

function parseBase(service: string, text: string): Upstream {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`upstream ${service}: "${text}" is not a URL`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error(`upstream ${service}: use an http or https URL`);
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      `upstream ${service}: no credentials, query or fragment in the base URL`
    );

  const basePath = url.pathname.split('/').filter((segment) => segment !== '');
  if (!basePath.every((segment) => BASE_SEGMENT.test(segment)))
    throw new Error(
      `upstream ${service}: base path segments must be plain literals`
    );

  const pathname = basePath.map((segment) => `/${segment}`).join('');
  return { origin: url.origin, basePath, base: `${url.origin}${pathname}` };
}

/**
 * Build the service → upstream map from `service=url` flags and an optional
 * file's entries. A service named twice, or one the operation table doesn't
 * have, fails startup, so a typo can't leave a service unrouted.
 */
export function parseUpstreams(
  flags: readonly string[],
  file: Readonly<Record<string, string>>,
  services: ReadonlySet<string>
): ReadonlyMap<string, Upstream> {
  const entries: [string, string][] = [];

  for (const flag of flags) {
    const equals = flag.indexOf('=');
    if (equals <= 0)
      throw new Error(`--upstream "${flag}" must be <service>=<base url>`);
    entries.push([flag.slice(0, equals), flag.slice(equals + 1)]);
  }
  entries.push(...Object.entries(file));

  const upstreams = new Map<string, Upstream>();
  for (const [service, text] of entries) {
    if (!services.has(service))
      throw new Error(`upstream ${service}: no operation has this service`);
    if (upstreams.has(service))
      throw new Error(`upstream ${service} is configured twice`);
    upstreams.set(service, parseBase(service, text));
  }
  return upstreams;
}

export async function readUpstreamsFile(path: string) {
  return readJsonFile(path, UpstreamsFile);
}

const USER_API_KEY_PREFIX = 'mak_';
const BOT_TOKEN_PREFIX = 'mbot_';

/**
 * The header the services expect for a user credential, chosen the way the
 * TypeScript SDK chooses it (`packages/sdk/src/utils/client.ts`): a `mak_`
 * API key goes in `x-macro-user-api-key`, anything else is a bearer token.
 */
export function credentialHeader(credential: string): [string, string] {
  if (credential.startsWith(BOT_TOKEN_PREFIX))
    throw new Error('MACRO_API_KEY holds a bot token; use a user credential');
  if (credential.startsWith(USER_API_KEY_PREFIX))
    return ['x-macro-user-api-key', credential];
  return ['authorization', `Bearer ${credential}`];
}
