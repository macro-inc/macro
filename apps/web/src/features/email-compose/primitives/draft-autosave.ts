import { debounce } from '@solid-primitives/scheduled';
import { createSignal, onCleanup } from 'solid-js';

/** Capture live editor values before queuing; each write sees the preceding draft ID. */
export function createDraftAutosave<Snapshot, Result>(options: {
  capture(): Snapshot;
  persist(snapshot: Snapshot): Promise<Result>;
  /** Runs immediately on edits; network debounce never delays local durability. */
  saveLocalSnapshot?(snapshot: Snapshot): Promise<void>;
  paused(): boolean;
  onError?(error: unknown): void;
  onLocalError?(error: unknown): void;
  onLocalSaved?(): void;
}) {
  let pending: { snapshot: Snapshot } | undefined;
  let failed: { snapshot: Snapshot } | undefined;
  let queue: Promise<Result | undefined> = Promise.resolve(undefined);
  let localWrites: Promise<void> = Promise.resolve();
  let newestSnapshot = 0;
  const [localSaveState, setLocalSaveState] = createSignal<
    'saving' | 'saved' | 'failed'
  >('saved');
  const flushLocal = async () => {
    for (;;) {
      const pending = localWrites;
      await pending;
      if (pending === localWrites) return;
    }
  };
  const saveLocally = (snapshot: Snapshot) => {
    const revision = ++newestSnapshot;
    setLocalSaveState('saving');
    const writeNewestSnapshot = async () => {
      // Coalesce snapshots waiting behind a slow file write. An already
      // running write finishes before the newest snapshot can replace it.
      if (revision !== newestSnapshot) return;
      try {
        await options.saveLocalSnapshot?.(snapshot);
        if (revision === newestSnapshot) {
          failed = undefined;
          setLocalSaveState('saved');
          options.onLocalSaved?.();
        }
      } catch (error) {
        if (revision === newestSnapshot) {
          failed = { snapshot };
          setLocalSaveState('failed');
        }
        options.onLocalError?.(error);
        throw error;
      }
    };
    // A failed disk write must not prevent the next edit from trying again.
    localWrites = localWrites.then(writeNewestSnapshot, writeNewestSnapshot);
    return flushLocal();
  };
  const cancel = () => {
    scheduled.clear();
    pending = undefined;
    failed = undefined;
  };
  const enqueue = (snapshot: Snapshot, local: Promise<void>) => {
    const write = async () => {
      await local;
      return await options.persist(snapshot);
    };
    queue = queue.then(write, write);
    return queue;
  };
  const save = (snapshot = options.capture()) => {
    cancel();
    return enqueue(snapshot, saveLocally(snapshot));
  };
  const scheduled = debounce(() => {
    if (options.paused()) return;
    void save().catch((error) => options.onError?.(error));
  }, 500);
  // WebKit can suspend storage and timers once the app is hidden, and aborts
  // writes in flight. Send the debounced server save before that happens, and
  // retry a failed local write whenever visibility changes.
  const flushOnVisibilityChange = () => {
    if (options.paused() || (!pending && !failed)) return;
    void save().catch((error) => options.onError?.(error));
  };
  document.addEventListener('visibilitychange', flushOnVisibilityChange);
  onCleanup(() => {
    document.removeEventListener('visibilitychange', flushOnVisibilityChange);
    const retry = failed;
    const flush = pending ?? retry;
    cancel();
    // Reading the live thread/editor here can reenter Solid's disposal of
    // that same view. The last edit already captured its local copy; a copy
    // that failed is written again before the editor holding it is gone.
    if (flush && !options.paused())
      void enqueue(
        flush.snapshot,
        retry ? saveLocally(flush.snapshot) : flushLocal()
      ).catch((error) => options.onError?.(error));
  });
  return {
    save,
    async saveLocal(snapshot = options.capture()) {
      cancel();
      await saveLocally(snapshot);
    },
    cancel,
    settled: () => queue,
    flushLocal,
    localSaveState,
    schedule() {
      if (options.paused()) return;
      const snapshot = options.capture();
      pending = { snapshot };
      void saveLocally(snapshot).catch((error) => options.onError?.(error));
      scheduled();
    },
  };
}
