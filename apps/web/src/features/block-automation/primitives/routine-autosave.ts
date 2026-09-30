import { debounce } from '@solid-primitives/scheduled';
import { type Accessor, createSignal, onCleanup } from 'solid-js';

type RoutineAutosave<T> = {
  dirty: Accessor<boolean>;
  saving: Accessor<boolean>;
  error: Accessor<unknown>;
  queue: (draft: T | undefined) => void;
  retry: () => void;
  cancel: () => void;
};

/** Serializes routine writes; undefined invalidates an older, still-valid draft. */
export function createRoutineAutosave<T>(
  save: (draft: T) => Promise<void>
): RoutineAutosave<T> {
  const [dirty, setDirty] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<unknown>();
  let pending: { draft: T; revision: number } | undefined;
  let revision = 0;
  let ready = false;
  let disposed = false;

  async function drain(): Promise<void> {
    if (disposed || saving() || !ready || !pending) return;
    const write = pending;
    pending = undefined;
    ready = false;
    setSaving(true);
    try {
      await save(write.draft);
      if (!disposed && write.revision === revision) {
        setDirty(false);
        setError(undefined);
      }
    } catch (failure) {
      if (!disposed && write.revision === revision) {
        pending = write;
        setError(() => failure);
      }
    } finally {
      setSaving(false);
      // A newer edit may have finished debouncing during this request.
      if (ready) void drain();
    }
  }

  const debouncedSave = debounce(() => {
    ready = true;
    void drain();
  }, 300);

  function queue(draft: T | undefined): void {
    if (disposed) return;
    revision += 1;
    pending = draft === undefined ? undefined : { draft, revision };
    ready = false;
    setDirty(true);
    setError(undefined);
    debouncedSave.clear();
    if (pending) debouncedSave();
  }

  function retry(): void {
    if (disposed || !pending) return;
    setError(undefined);
    debouncedSave.clear();
    ready = true;
    void drain();
  }

  function cancel(): void {
    revision += 1;
    pending = undefined;
    ready = false;
    debouncedSave.clear();
    setDirty(false);
    setError(undefined);
  }

  onCleanup(() => {
    disposed = true;
    cancel();
  });

  return { dirty, saving, error, queue, retry, cancel };
}
