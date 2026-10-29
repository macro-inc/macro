import { createSignal, onCleanup } from 'solid-js';

export function createBookingPageLeave(options: {
  dirty: () => boolean;
  busy: () => boolean;
  save: () => Promise<void>;
  discard: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  let disposed = false;
  let pending:
    | {
        promise: Promise<boolean>;
        resolve: (allow: boolean) => void;
        cleanup: () => void;
        signal?: AbortSignal;
      }
    | undefined;
  const busy = () => saving() || options.busy();
  const finish = (allow: boolean) => {
    const request = pending;
    pending = undefined;
    setOpen(false);
    request?.cleanup();
    request?.resolve(allow);
  };
  const requestLeave = (signal?: AbortSignal): boolean | Promise<boolean> => {
    if (disposed || signal?.aborted) return false;
    // A router navigation supersedes a local tab/owner decision, and vice versa.
    if (pending && pending.signal !== signal) finish(false);
    if (!options.dirty()) return true;
    if (busy()) return false;
    if (pending) return pending.promise;
    let resolve!: (allow: boolean) => void;
    const promise = new Promise<boolean>((done) => {
      resolve = done;
    });
    const abort = () => finish(false);
    pending = {
      promise,
      resolve,
      signal,
      cleanup: () => signal?.removeEventListener('abort', abort),
    };
    signal?.addEventListener('abort', abort, { once: true });
    setError('');
    setOpen(true);
    return promise;
  };
  const keepEditing = () => {
    if (!busy()) finish(false);
  };
  const discard = () => {
    if (!pending || busy()) return;
    options.discard();
    finish(true);
  };
  const save = async () => {
    const request = pending;
    if (!request || busy()) return;
    setError('');
    setSaving(true);
    try {
      await options.save();
      if (!disposed && pending === request) {
        if (!options.dirty()) finish(true);
        else setError('Your latest changes still need to be saved.');
      }
    } catch (error) {
      if (!disposed && pending === request)
        setError(
          error instanceof Error
            ? error.message
            : 'Could not save your booking page.'
        );
    } finally {
      if (!disposed) setSaving(false);
    }
  };
  onCleanup(() => {
    disposed = true;
    finish(false);
  });
  return { open, busy, error, requestLeave, keepEditing, discard, save };
}
