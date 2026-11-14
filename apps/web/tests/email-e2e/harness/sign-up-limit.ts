// The authentication service lets one client address create a fixed number
// of accounts an hour, and counts them in Redis. Every test on the local
// stack signs up a user of its own from this machine's one address, so the
// tier clears that counter in the stack's own Redis before each sign-up.
//
// The key is read from the code that writes it, and a sign-up is checked to
// leave one behind (`checkSignUpCounter`): a counter that moved would
// otherwise come back as sign-ups answered 500 part of the way into a run.

import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';

const COUNTER_SOURCE = fileURLToPath(
  new URL(
    '../../../../../crates/macro_cache_client/src/create_user_rate_limit.rs',
    import.meta.url
  )
);
/** The key as the service formats it: a prefix, then the client's address. */
const COUNTER_KEY = /format!\("(rtl_create_user_hourly:)\{\}", \$ip\)/;
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

let prefix: string | undefined;

/** The prefix of the counter's keys, from the service's own source. */
export function signUpCounterPrefix(): string {
  if (prefix) return prefix;
  const found = COUNTER_KEY.exec(readFileSync(COUNTER_SOURCE, 'utf8'));
  if (!found) {
    throw new Error(
      `${COUNTER_SOURCE} no longer names the sign-up counter as ${COUNTER_KEY}: update harness/sign-up-limit.ts to the key it writes now`
    );
  }
  prefix = found[1];
  return prefix;
}

/** The counters there are now, one for each client address. */
export async function signUpCounters(redisUrl: string): Promise<string[]> {
  const keys = await command(redisUrl, ['KEYS', `${signUpCounterPrefix()}*`]);
  if (!Array.isArray(keys)) {
    throw new Error(`KEYS answered ${JSON.stringify(keys)}`);
  }
  return keys.map(String);
}

/** Removes every sign-up counter in the local stack's Redis. */
export async function clearSignUpCounters(redisUrl: string): Promise<void> {
  const keys = await signUpCounters(redisUrl);
  if (keys.length > 0) await command(redisUrl, ['DEL', ...keys]);
}

/**
 * Fails unless a sign-up has left a counter where this module clears it.
 * Called once a run, after a sign-up, before any test.
 */
export async function checkSignUpCounter(redisUrl: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await signUpCounters(redisUrl)).length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `a sign-up left no ${signUpCounterPrefix()}* key in ${redisUrl}: the authentication service counts sign-ups somewhere else now, so harness/sign-up-limit.ts clears nothing and a long run will be refused new accounts`
  );
}

type Reply = string | number | null | Reply[];

/** One command to the stack's Redis, which must be on this machine. */
function command(redisUrl: string, words: string[]): Promise<Reply> {
  const target = new URL(redisUrl);
  if (target.protocol !== 'redis:' || !LOCAL_HOSTS.includes(target.hostname)) {
    throw new Error(
      `${redisUrl} is not a local stack's Redis: the sign-up counter is cleared only on this machine`
    );
  }
  const request = `*${words.length}\r\n${words
    .map((word) => `$${Buffer.byteLength(word)}\r\n${word}\r\n`)
    .join('')}`;
  return new Promise((resolve, reject) => {
    const socket = connect(Number(target.port || 6379), target.hostname);
    let received = Buffer.alloc(0);
    socket.setTimeout(5_000, () => {
      socket.destroy(new Error(`${redisUrl} did not answer ${words[0]}`));
    });
    socket.on('error', reject);
    // Closed before a whole reply: nothing more will come.
    socket.on('close', () =>
      reject(new Error(`${redisUrl} closed before it answered ${words[0]}`))
    );
    socket.on('connect', () => socket.write(request));
    socket.on('data', (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      try {
        const parsed = parse(received, 0);
        if (!parsed) return;
        socket.destroy();
        resolve(parsed.reply);
      } catch (error) {
        socket.destroy();
        reject(error);
      }
    });
  });
}

/** One reply at `from`, or nothing while it is still arriving. */
function parse(
  data: Buffer,
  from: number
): { reply: Reply; next: number } | undefined {
  const end = data.indexOf('\r\n', from);
  if (end < 0) return undefined;
  const kind = String.fromCharCode(data[from]);
  const line = data.toString('utf8', from + 1, end);
  const next = end + 2;
  if (kind === '+') return { reply: line, next };
  if (kind === ':') return { reply: Number(line), next };
  if (kind === '-') throw new Error(`Redis answered an error: ${line}`);
  if (kind === '$') {
    const length = Number(line);
    if (length < 0) return { reply: null, next };
    if (data.length < next + length + 2) return undefined;
    return {
      reply: data.toString('utf8', next, next + length),
      next: next + length + 2,
    };
  }
  if (kind === '*') {
    const items: Reply[] = [];
    let at = next;
    for (let index = 0; index < Number(line); index += 1) {
      const item = parse(data, at);
      if (!item) return undefined;
      items.push(item.reply);
      at = item.next;
    }
    return { reply: items, next: at };
  }
  throw new Error(`Redis answered something unreadable: ${kind}${line}`);
}
