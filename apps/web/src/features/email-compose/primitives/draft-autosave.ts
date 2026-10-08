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
  let queue: Promise<Result | undefined> = Promise.resolve(undefined);
  let localWrites: Promise<void> = Promise.resolve();
  let newestSnapshot = 0;
  const [inputIdle, setInputIdle] = createSignal(true);
  const [shouldAcknowledge, setShouldAcknowledge] = createSignal(true);
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
          setLocalSaveState('saved');
          options.onLocalSaved?.();
        }
      } catch (error) {
        if (revision === newestSnapshot) setLocalSaveState('failed');
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
    setInputIdle(true);
  };
  const enqueue = (snapshot: Snapshot, local: Promise<void>) => {
    const write = async () => {
      await local;
      return await options.persist(snapshot);
    };
    queue = queue.then(write, write);
    return queue;
  };
  const save = (
    snapshot = options.capture(),
    saveOptions: { acknowledge?: boolean } = {}
  ) => {
    setShouldAcknowledge(saveOptions.acknowledge !== false);
    cancel();
    return enqueue(snapshot, saveLocally(snapshot));
  };
  const scheduled = debounce(() => {
    setInputIdle(true);
    if (options.paused()) return;
    void save().catch((error) => options.onError?.(error));
  }, 500);
  onCleanup(() => {
    const flush = pending;
    cancel();
    // Reading the live thread/editor here can reenter Solid's disposal of
    // that same view. The last edit already captured and queued its local copy.
    if (flush && !options.paused())
      void enqueue(flush.snapshot, flushLocal()).catch((error) =>
        options.onError?.(error)
      );
  });
  return {
    save,
    cancel,
    settled: () => queue,
    flushLocal,
    localSaveState,
    acknowledgeSaved: () => inputIdle() && shouldAcknowledge(),
    schedule() {
      if (options.paused()) return;
      setShouldAcknowledge(true);
      setInputIdle(false);
      const snapshot = options.capture();
      pending = { snapshot };
      void saveLocally(snapshot).catch((error) => options.onError?.(error));
      scheduled();
    },
  };
}
