/** How a stream's start is tried again after it fails, e.g. while Macro is unreachable. */
export const startBackoff = { firstMs: 1_000, maxMs: 60_000 } as const;

/** The wait before start attempt `attempt + 1`: doubling, up to the ceiling. */
export const backoffMs = (attempt: number): number =>
  Math.min(startBackoff.maxMs, startBackoff.firstMs * 2 ** (attempt - 1));

export type Retry = {
  readonly wait: (ms: number) => Promise<void>;
  /** A start failed; it is tried again after `delayMs`. */
  readonly report: (error: unknown, delayMs: number) => void;
};

const retryOnConsole: Retry = {
  wait: (ms) => Bun.sleep(ms),
  report: (error, delayMs) =>
    console.error(
      `stream: start failed, trying again in ${delayMs / 1000} s: ${String(error)}`
    ),
};

/**
 * An endless stream of things pushed in from callbacks, e.g. an SDK's event
 * handlers. `start` is called when the stream is first read, and whatever it
 * emits is kept until it is read, so nothing is dropped while a reader is
 * busy. A start that fails (the network: an agent's machine goes offline) is
 * tried again with backoff instead of failing the stream, so it must register
 * nothing before it can fail.
 */
export const pushed = <Item>(
  start: (emit: (item: Item) => void) => Promise<void>,
  retry: Retry = retryOnConsole
): AsyncIterable<Item> => ({
  [Symbol.asyncIterator]: () => {
    const waiting: Item[] = [];
    let wake: (() => void) | undefined;
    let started: Promise<void> | undefined;
    const emit = (item: Item): void => {
      waiting.push(item);
      wake?.();
    };
    const starting = async (): Promise<void> => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await start(emit);
        } catch (error) {
          const delayMs = backoffMs(attempt);
          retry.report(error, delayMs);
          await retry.wait(delayMs);
        }
      }
    };
    return {
      next: async () => {
        started ??= starting();
        await started;
        while (waiting.length === 0)
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        const [value] = waiting.splice(0, 1);
        if (value === undefined) throw new Error('the stream lost an item');
        return { done: false, value };
      },
    };
  },
});

export type Batches<Item> = {
  readonly push: (key: string, item: Item) => void;
  /** Marks the key's batch as done, so its next one may be read. */
  readonly release: (key: string) => void;
  readonly stream: AsyncIterable<{
    readonly key: string;
    readonly items: readonly Item[];
  }>;
};

export const batches = <Item>(): Batches<Item> => {
  const queued = new Map<string, Item[]>();
  const busy = new Set<string>();
  let wake: (() => void) | undefined;
  const ready = (): string | undefined =>
    [...queued.keys()].find((key) => !busy.has(key));
  return {
    push: (key, item) => {
      queued.set(key, [...(queued.get(key) ?? []), item]);
      wake?.();
    },
    release: (key) => {
      busy.delete(key);
      wake?.();
    },
    stream: {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          let key = ready();
          while (key === undefined) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            key = ready();
          }
          const items = queued.get(key) ?? [];
          queued.delete(key);
          busy.add(key);
          return { done: false, value: { key, items } };
        },
      }),
    },
  };
};
