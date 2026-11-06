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
  finish: (current: () => boolean) => Promise<void>
) {
  const captured = Symbol();
  transition = captured;
  session = undefined;
  const drained = Promise.allSettled([...pending]);
  const completed = transitions.then(async () => {
    await drained;
    await finish(() => transition === captured);
  });
  // A failed wipe must leave admission closed without poisoning future login.
  transitions = completed.catch(() => {});
  return completed;
}

/** Close admission immediately and drain durable writes before clearing storage. */
export function endCacheWriteSession(clear: () => Promise<void>) {
  return transitionCacheWrites(clear);
}

/** A successful login may replace an account without changing host identity. */
export function beginCacheWriteSession(clear: () => Promise<void>) {
  const next = Symbol();
  const ready = transitionCacheWrites(async (isCurrent) => {
    await clear();
    if (isCurrent()) session = next;
  });
  return { ready, isCurrent: () => session === next };
}
