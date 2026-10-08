import type { ResultAsync } from 'neverthrow';
import { createSignal, onCleanup } from 'solid-js';

/**
 * An inline name editor's state: the target being renamed, its draft, the
 * pending save and the message explaining a refusal. Saving with
 * `restoreFocus` false is a blur, which leaves focus where the user put it.
 */
export function createInlineRename<Target, Failure>(options: {
  name: (target: Target) => string;
  rename: (target: Target, name: string) => ResultAsync<unknown, Failure>;
  failureMessage: (failure: Failure) => string;
  /** `cancel` drops a name emptied before blurring instead of asking for one. */
  emptyName: { message: string; onBlur: 'keep-editing' | 'cancel' };
  /** Why `name` is refused before it is sent, if it is. */
  validate?: (name: string, target: Target) => string | undefined;
  input: () => HTMLInputElement | undefined;
  restoreFocus: (target: Target) => void;
}) {
  const [target, setTarget] = createSignal<Target>();
  const [draft, setDraft] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const finish = (restoreFocus: boolean) => {
    const current = target();
    setTarget(undefined);
    setError('');
    if (restoreFocus && current !== undefined)
      queueMicrotask(() => options.restoreFocus(current));
  };
  return {
    target,
    draft,
    pending,
    error,
    setError,
    setDraft: (name: string) => {
      setDraft(name);
      setError('');
    },
    begin: (next: Target) => {
      if (pending()) return;
      setDraft(options.name(next));
      setError('');
      setTarget(() => next);
      queueMicrotask(() => {
        const input = options.input();
        input?.focus();
        input?.select();
      });
    },
    cancel: (restoreFocus: boolean) => {
      if (!pending()) finish(restoreFocus);
    },
    save: async (restoreFocus: boolean) => {
      const current = target();
      if (current === undefined || pending()) return;
      const name = draft().trim();
      if (!name) {
        if (!restoreFocus && options.emptyName.onBlur === 'cancel')
          finish(false);
        else setError(options.emptyName.message);
        return;
      }
      const refusal = options.validate?.(name, current);
      if (refusal) {
        setError(refusal);
        return;
      }
      if (name === options.name(current)) {
        finish(restoreFocus);
        return;
      }
      const renaming = options.rename(current, name);
      setPending(true);
      setError('');
      const renamed = await renaming;
      if (disposed) return;
      setPending(false);
      renamed.match(
        () => finish(restoreFocus),
        (failure) => setError(options.failureMessage(failure))
      );
    },
  };
}
