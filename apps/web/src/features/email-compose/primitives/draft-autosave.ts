import { debounce } from '@solid-primitives/scheduled';
import { onCleanup } from 'solid-js';

/** Capture live editor values before queuing; each write sees the preceding draft ID. */
export function createDraftAutosave<Snapshot, Result>(options: {
  capture(): Snapshot;
  persist(snapshot: Snapshot): Promise<Result>;
  paused(): boolean;
}) {
  let pending = false;
  let queue: Promise<Result | undefined> = Promise.resolve(undefined);
  const cancel = () => {
    scheduled.clear();
    pending = false;
  };
  const save = (snapshot = options.capture()) => {
    cancel();
    const write = () => options.persist(snapshot);
    queue = queue.then(write, write);
    return queue;
  };
  const scheduled = debounce(() => {
    if (options.paused()) return;
    void save().catch(() => {});
  }, 500);
  onCleanup(() => {
    const flush = pending && !options.paused();
    cancel();
    if (flush) void save().catch(() => {});
  });
  return {
    save,
    cancel,
    settled: () => queue,
    schedule() {
      if (options.paused()) return;
      pending = true;
      scheduled();
    },
  };
}
