/**
 * An endless stream of things pushed in from callbacks, e.g. an SDK's event
 * handlers. `start` is called once, when the stream is first read, and
 * whatever it emits is kept until it is read, so nothing is dropped while a
 * reader is busy.
 */
export const pushed = <Item>(
  start: (emit: (item: Item) => void) => Promise<void>
): AsyncIterable<Item> => ({
  [Symbol.asyncIterator]: () => {
    const waiting: Item[] = [];
    let wake: (() => void) | undefined;
    let started: Promise<void> | undefined;
    const emit = (item: Item): void => {
      waiting.push(item);
      wake?.();
    };
    return {
      next: async () => {
        started ??= start(emit);
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

/**
 * Items batched by key, e.g. messages by conversation. Each key yields one
 * batch at a time: everything pushed for it while it was `busy`, once it is
 * `release`d. Different keys don't wait on each other.
 */
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
