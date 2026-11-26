// One HTTP request, to a plain address or to the local stack's proxy, whose
// certificate is signed by the repository's development authority
// (`infra/local/certs`). `fetch` cannot be told to trust that authority
// without a process-wide setting, so the request is made with `node:https`.

import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { fileURLToPath } from 'node:url';

const AUTHORITY = fileURLToPath(
  new URL('../../../../../infra/local/certs/ca.pem', import.meta.url)
);

let authority: Buffer | undefined;

/**
 * A stack is reached over IPv4. A machine with many container networks answers
 * its own name with hundreds of link-local IPv6 addresses, slowly, and trying
 * them one after another can outlast a test.
 */
export const STACK_ADDRESS_FAMILY = 4;

/** The development certificate authority the local stack's proxy is signed by. */
export function developmentAuthority(): Buffer {
  authority ??= readFileSync(AUTHORITY);
  return authority;
}

export type Answer = {
  status: number;
  /** Lower-case names; `set-cookie` keeps every value. */
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
};

/** Makes one request and answers what came back, whatever its status. */
export function send(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: Buffer | string;
  } = {}
): Promise<Answer> {
  const target = new URL(url);
  const secure = target.protocol === 'https:';
  return new Promise((resolve, reject) => {
    const outgoing = (secure ? httpsRequest : httpRequest)(
      target,
      {
        method: init.method ?? 'GET',
        headers: init.headers,
        family: STACK_ADDRESS_FAMILY,
        ca: secure ? developmentAuthority() : undefined,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.on('error', reject);
        incoming.on('end', () =>
          resolve({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            body: Buffer.concat(chunks),
          })
        );
      }
    );
    outgoing.setTimeout(60_000, () => {
      outgoing.destroy(new Error(`${url} did not answer in a minute`));
    });
    outgoing.on('error', reject);
    outgoing.end(init.body);
  });
}

/** A JSON request that must succeed; answers the parsed body. */
export async function sendJson<T>(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {}
): Promise<T> {
  const answer = await send(url, {
    method: init.method,
    headers: {
      ...(init.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = answer.body.toString('utf8');
  if (answer.status < 200 || answer.status >= 300) {
    throw new Error(
      `${init.method ?? 'GET'} ${url} answered ${answer.status}:\n${text}`
    );
  }
  return (text ? JSON.parse(text) : undefined) as T;
}
