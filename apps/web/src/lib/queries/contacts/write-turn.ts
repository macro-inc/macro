// A scan page or top-up captures the cache's one contact fence before its fetch
// and consumes it when it persists, so a write that lands between another's
// capture and persist makes that one fail as stale. The two therefore take
// turns on each cache host, in the order they asked. A replaced host starts a
// new line, so a write stuck on a retired host never holds up its successor.
const tails = new WeakMap<object, Promise<void>>();

/** Waits for every earlier contact write on `host`, then holds the turn until
 * `release`. */
export async function acquireContactWriteTurn(
  host: object
): Promise<() => void> {
  const previous = tails.get(host) ?? Promise.resolve();
  let release = () => {};
  tails.set(
    host,
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  await previous;
  return release;
}

export async function withContactWriteTurn<T>(
  host: object,
  write: () => Promise<T>
): Promise<T> {
  const release = await acquireContactWriteTurn(host);
  try {
    return await write();
  } finally {
    release();
  }
}
