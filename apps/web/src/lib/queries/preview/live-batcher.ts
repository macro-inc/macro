type Entry<Item, Batch> = {
  item: Item;
  listeners: Set<(batch: Batch) => void>;
  ready: Promise<Batch | undefined>;
  resolve: (batch: Batch | undefined) => void;
  group?: { entries: Entry<Item, Batch>[]; value: Batch; dispose: () => void };
};

/**
 * Coalesces mounted lookups into stable, reference-counted live query batches.
 * A batch's variables never grow/change after dispatch: sibling mounts cannot
 * cancel a request or clear another preview. The last consumer owns teardown.
 * Create one batcher per client/session and query selection, not per component.
 */
export function createLivePreviewBatcher<Item, Batch>(options: {
  start: (items: Item[]) => { value: Batch; dispose: () => void };
  wait?: number;
  maxSize?: number;
}) {
  const entries = new Map<string, Entry<Item, Batch>>();
  const pending = new Map<string, Entry<Item, Batch>>();
  const maxSize = options.maxSize ?? 50;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    while (pending.size) {
      const next = [...pending.entries()].slice(0, maxSize);
      for (const [key] of next) pending.delete(key);
      const members = next.map(([, entry]) => entry);
      const started = options.start(members.map((entry) => entry.item));
      const group = { ...started, entries: members };
      // Assign every member before notifying: a synchronous consumer cleanup
      // must not dispose a group whose other listeners haven't been notified.
      for (const entry of members) entry.group = group;
      for (const entry of members) {
        entry.resolve(group.value);
        for (const listener of entry.listeners) listener(group.value);
      }
    }
  };

  return {
    acquire(key: string, item: Item, listener: (batch: Batch) => void) {
      let entry = entries.get(key);
      if (!entry) {
        let resolve!: Entry<Item, Batch>['resolve'];
        const ready = new Promise<Batch | undefined>((done) => {
          resolve = done;
        });
        entry = { item, listeners: new Set(), ready, resolve };
        entries.set(key, entry);
        pending.set(key, entry);
      }
      const current = entry;
      current.listeners.add(listener);
      if (current.group) listener(current.group.value);
      else if (pending.size >= maxSize) flush();
      else timer ??= setTimeout(flush, options.wait ?? 30);

      let disposed = false;
      return {
        ready: current.ready,
        dispose() {
          if (disposed) return;
          disposed = true;
          current.listeners.delete(listener);
          if (current.listeners.size) return;
          entries.delete(key);
          pending.delete(key);
          current.resolve(undefined);
          if (!pending.size) {
            clearTimeout(timer);
            timer = undefined;
          }
          const group = current.group;
          if (
            group &&
            group.entries.every((entry) => entry.listeners.size === 0)
          ) {
            group.dispose();
          }
        },
      };
    },
  };
}
