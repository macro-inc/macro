// REST responses can arrive after logout or native account replacement. Track
// their durable cache mutations so a wipe cannot overtake an admitted write.
let session: symbol | undefined = Symbol();
let transition: symbol;
let transitions = Promise.resolve();
const pending = new Set<Promise<void>>();

export function captureCacheWriteSession() {
  const captured = session;
  const isCurrent = () => captured !== undefined && captured === session;
  return {
    isCurrent,
    async run(write: () => Promise<void>) {
      if (!isCurrent()) return;
      // Register before invoking the callback, including synchronous failures.
      const operation = Promise.resolve().then(async () => {
        if (isCurrent()) await write();
      });
      pending.add(operation);
      try {
        await operation;
      } finally {
        pending.delete(operation);
      }
    },
  };
}

function transitionCacheWrites(
  finish: (current: () => boolean, drained: Promise<void>) => Promise<void>
) {
  const captured = Symbol();
  transition = captured;
  session = undefined;
  const drained = Promise.allSettled([...pending]);
  const ready = transitions.then(async () => {
    await drained;
  });
  // Independent sign-out work starts immediately. Even if it fails, the tail
  // cannot release a replacement session before older storage work settles.
  const finishing = Promise.resolve().then(() =>
    finish(() => transition === captured, ready)
  );
  const completed = Promise.allSettled([ready, finishing]).then((results) => {
    const result = results[1];
    if (result.status === 'rejected') throw result.reason;
  });
  // A failed wipe must leave admission closed without poisoning future login.
  transitions = completed.catch(() => {});
  return completed;
}

/** Close admission immediately and drain durable writes before clearing storage. */
export function endCacheWriteSession(
  clear: (drained: Promise<void>) => Promise<void>
) {
  return transitionCacheWrites((_current, drained) => clear(drained));
}

/** A successful login may replace an account without changing host identity. */
export function beginCacheWriteSession(clear: () => Promise<void>) {
  const next = Symbol();
  const ready = transitionCacheWrites(async (isCurrent, drained) => {
    await drained;
    await clear();
    if (isCurrent()) session = next;
  });
  return { ready, isCurrent: () => session === next };
}
