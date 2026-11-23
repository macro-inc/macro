import { debounce } from '@core/util/debounce';
import { createSignal, onCleanup } from 'solid-js';

/** Wait for a successful copy, then reset feedback after the last success. */
export function createCopyState() {
  const [copied, setCopied] = createSignal(false);
  const reset = debounce(() => setCopied(false), 1400);
  let pending = false;
  let disposed = false;

  onCleanup(() => {
    disposed = true;
    reset.clear();
  });

  async function copy(action: () => unknown) {
    if (pending || disposed) return;
    pending = true;

    try {
      const result = await action();
      if (disposed) return;

      setCopied(result !== false);
      if (result !== false) reset();
      else reset.clear();
    } catch {
      // Copy handlers report errors; failed copies never show success.
      if (!disposed) setCopied(false);
      reset.clear();
    } finally {
      pending = false;
    }
  }

  return { copied, copy };
}
