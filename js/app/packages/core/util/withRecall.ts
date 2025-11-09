type FnWithRecall<F extends (...args: any[]) => any, K> = ((
  ...args: Parameters<F>
) => ReturnType<F>) & {
  clear(): void;
  delete(keyOrArg: K): boolean;
  peek(keyOrArg: K): ReturnType<F> | undefined;
  size(): number;
};

/**
 * Memoize a pure function of a single *keyable* param and return results from
 * the internal cache.
 */
export function withRecall<A extends PropertyKey, R>(
  fn: (arg: A) => R
): FnWithRecall<typeof fn, A> {
  const store = new Map<A, R>();

  const wrapped = ((arg: A): R => {
    if (store.has(arg)) {
      return store.get(arg)!;
    }
    const out = fn(arg);
    store.set(arg, out);
    return out;
  }) as FnWithRecall<typeof fn, A>;

  wrapped.clear = () => store.clear();
  wrapped.delete = (key: A) => store.delete(key);
  wrapped.peek = (key: A) => store.get(key);
  wrapped.size = () => store.size;

  return wrapped;
}
