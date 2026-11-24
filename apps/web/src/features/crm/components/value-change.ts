import { createSignal, onCleanup } from 'solid-js';

/**
 * One pending change at a time to one of a record's listed values (a
 * contact's addresses, a company's domains), with the rejection kept beside
 * its control.
 */
export function createValueChange<Kind>(
  change: (value: string, kind: Kind) => Promise<void>,
  message: (error: unknown, kind: Kind) => string
) {
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let active = true;
  onCleanup(() => {
    active = false;
  });

  return {
    saving,
    error,
    clearError: () => setError(undefined),
    /** Resolves to whether the server committed the change. */
    async run(value: string, kind: Kind) {
      if (saving()) return false;
      setSaving(true);
      setError(undefined);
      try {
        await change(value, kind);
        return true;
      } catch (cause) {
        if (active) setError(message(cause, kind));
        return false;
      } finally {
        if (active) setSaving(false);
      }
    },
  };
}

export type ValueChange<Kind> = ReturnType<typeof createValueChange<Kind>>;
