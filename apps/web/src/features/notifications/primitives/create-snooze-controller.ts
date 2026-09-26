import { createSignal } from 'solid-js';

/** Keep failures in the picker so a rejected write can be retried. */
export function createSnoozeController(options: {
  save: (until: string) => Promise<void>;
  onSaved: (until: string) => void;
  now?: () => number;
}) {
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const submit = async (until: Date) => {
    if (pending()) return;
    if (
      !Number.isFinite(until.getTime()) ||
      until.getTime() <= (options.now?.() ?? Date.now())
    ) {
      setError('Choose a time in the future.');
      return;
    }
    setPending(true);
    setError(undefined);
    const deadline = until.toISOString();
    try {
      await options.save(deadline);
    } catch {
      setError('Could not snooze all selected items. Please try again.');
      setPending(false);
      return;
    }
    setPending(false);
    options.onSaved(deadline);
  };
  return { pending, error, submit };
}
