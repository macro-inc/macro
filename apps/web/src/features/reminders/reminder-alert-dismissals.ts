import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';

/** Browser-local acknowledgements, scoped to the account and shared across tabs. */
export function createReminderAlertDismissals(
  userId: Accessor<string | undefined>
) {
  const storageKey = () => `macro:reminder-alerts:${userId() ?? ''}`;
  const read = (): string[] => {
    if (!userId()) return [];
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem(storageKey()) ?? '[]'
      );
      return Array.isArray(value)
        ? value.filter((key): key is string => typeof key === 'string')
        : [];
    } catch {
      return [];
    }
  };
  const [keys, setKeys] = createSignal<string[]>(read());
  createEffect(on(userId, () => setKeys(read())));

  const acknowledge = (acknowledged: string[]) => {
    const next = [...new Set([...read(), ...keys(), ...acknowledged])].sort();
    setKeys(next);
    try {
      const serialized = JSON.stringify(next);
      if (localStorage.getItem(storageKey()) !== serialized) {
        localStorage.setItem(storageKey(), serialized);
      }
    } catch {
      // Keep the in-memory acknowledgement when browser storage is unavailable.
    }
  };

  const onStorage = (event: StorageEvent) => {
    if (
      event.key === null ||
      (event.key === storageKey() && event.newValue === null)
    ) {
      setKeys(read());
      return;
    }
    if (event.key !== storageKey()) return;
    try {
      const value: unknown = JSON.parse(event.newValue ?? '[]');
      // Merge both writers' values so concurrent closes converge. Canonical
      // ordering and the write comparison above prevent storage-event loops.
      acknowledge(
        Array.isArray(value)
          ? value.filter((key): key is string => typeof key === 'string')
          : []
      );
    } catch {
      acknowledge([]);
    }
  };
  window.addEventListener('storage', onStorage);
  onCleanup(() => window.removeEventListener('storage', onStorage));

  return {
    keys,
    acknowledge,
  };
}
