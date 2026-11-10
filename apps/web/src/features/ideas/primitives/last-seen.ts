import { makePersistedState } from '@app/lib/persistence';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { type Accessor, createSignal, onCleanup } from 'solid-js';

const STORAGE = createUserScopedStorage('macro:ideas:last-seen');

/**
 * When this person last looked at their ideas, kept per user on this device.
 * `before` is the time before this visit, which marks what is new during it;
 * leaving records now.
 */
export function createLastSeen(userId: Accessor<string | undefined>) {
  const id = userId();
  const [seenAt, setSeenAt] = makePersistedState(
    createSignal<string | undefined>(undefined),
    {
      storages: {
        restore: () => (id ? (STORAGE.read(id) ?? undefined) : undefined),
        write: (value) => {
          if (id && value) STORAGE.write(id, value);
        },
      },
    }
  );
  const before = seenAt();

  onCleanup(() => setSeenAt(new Date().toISOString()));

  return { before: () => before };
}
