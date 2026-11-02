import { makePersistedState } from '@app/lib/persistence';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createSignal, onCleanup } from 'solid-js';
import { parseRepositoryInput } from '../core/repository';

const STORAGE_KEY = 'agents-default-repository-v1';
const CHANGE_EVENT = 'agents-default-repository-changed';

/** The user's default for new coding conversations on this device; undefined means auto-detect. */
export function createPreferredRepository(userId: string | undefined) {
  const storage = createUserScopedStorage(STORAGE_KEY);
  const [repository, setRepository] = createSignal<string>();
  const read = () =>
    userId ? parseRepositoryInput(storage.read(userId) ?? '') : undefined;
  const [, persist] = makePersistedState([repository, setRepository], {
    storages: {
      restore: read,
      write: (value) => {
        if (!userId) return;
        storage.write(userId, value ?? '');
        window.dispatchEvent(
          new CustomEvent(CHANGE_EVENT, { detail: { userId, value } })
        );
      },
    },
  });

  // Settings and a composer may be mounted together in separate splits.
  // Storage events also pick up a preference changed in another browser tab.
  const onChange = (event: Event) => {
    if (!(event instanceof CustomEvent) || event.detail?.userId !== userId)
      return;
    setRepository(parseRepositoryInput(event.detail.value ?? ''));
  };
  const onStorage = (event: StorageEvent) => {
    if (
      userId &&
      (event.key === null ||
        event.key === `${STORAGE_KEY}:${encodeURIComponent(userId)}`)
    )
      setRepository(read());
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  onCleanup(() => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  });

  return {
    repository,
    select: (url: string | undefined) =>
      persist(url ? parseRepositoryInput(url) : undefined),
  };
}
