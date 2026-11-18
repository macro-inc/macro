import { t } from '@app/lib/i18n';
import { onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';

/** Shared leave decision used by editable pages and unsaved view definitions. */
export function createUnsavedChangesGuard(options: {
  dirty: () => boolean;
  busy: () => boolean;
  save: () => Promise<void>;
  discard: () => void;
  saveError: string;
}) {
  const [state, setState] = createStore({
    open: false,
    saving: false,
    error: '',
  });
  let disposed = false;
  let pending:
    | {
        promise: Promise<boolean>;
        resolve: (allow: boolean) => void;
        cleanup: () => void;
        signal?: AbortSignal;
      }
    | undefined;
  const busy = () => state.saving || options.busy();
  const finish = (allow: boolean) => {
    const request = pending;
    pending = undefined;
    setState('open', false);
    request?.cleanup();
    request?.resolve(allow);
  };
  const requestLeave = (signal?: AbortSignal): boolean | Promise<boolean> => {
    if (disposed || signal?.aborted) return false;
    // Router navigation supersedes a local decision, and vice versa.
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
    setState({ error: '', open: true });
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
    setState({ error: '', saving: true });
    try {
      await options.save();
      if (!disposed && pending === request) {
        if (!options.dirty()) finish(true);
        else setState('error', t('common.latestChangesUnsaved'));
      }
    } catch (error) {
      if (!disposed && pending === request)
        setState(
          'error',
          error instanceof Error ? error.message : options.saveError
        );
    } finally {
      if (!disposed) setState('saving', false);
    }
  };
  onCleanup(() => {
    disposed = true;
    finish(false);
  });
  return {
    open: () => state.open,
    busy,
    error: () => state.error,
    requestLeave,
    keepEditing,
    discard,
    save,
  };
}
