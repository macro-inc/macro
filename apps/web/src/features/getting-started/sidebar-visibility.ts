import { useUserId } from '@core/context/user';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createResource, createSignal } from 'solid-js';

/**
 * Persistence seam for the "Getting started" sidebar link's removed flag.
 * Async so a backend-backed implementation can slot in without touching
 * consumers (mirrors `GettingStartedStore`); the default is user-scoped
 * localStorage.
 */
export interface GettingStartedSidebarStore {
  /** The stored flag, or `null` when the user never removed the link. */
  load(userId: string): Promise<boolean | null>;
  save(userId: string, hidden: boolean): Promise<void>;
}

const storage = createUserScopedStorage('macro:getting-started-sidebar-hidden');

export const localStorageGettingStartedSidebarStore: GettingStartedSidebarStore =
  {
    load(userId) {
      const raw = storage.read(userId);
      return Promise.resolve(raw === null ? null : raw === 'true');
    },
    save(userId, hidden) {
      storage.write(userId, String(hidden));
      return Promise.resolve();
    },
  };

/**
 * User-scoped, reactive visibility of the "Getting started" sidebar link.
 * Starts visible and flips once the persisted flag loads; `hide` applies
 * optimistically and persists behind the store seam.
 */
export function createGettingStartedSidebarVisibility(
  store: GettingStartedSidebarStore = localStorageGettingStartedSidebarStore
) {
  const userId = useUserId();
  const [storedHidden] = createResource(userId, async (id) => ({
    userId: id,
    hidden: (await store.load(id)) ?? false,
  }));
  const [optimisticallyHiddenUserId, setOptimisticallyHiddenUserId] =
    createSignal<string>();

  const hidden = () => {
    const id = userId();
    if (!id) return false;
    if (optimisticallyHiddenUserId() === id) return true;

    const stored = storedHidden.latest;
    return stored?.userId === id && stored.hidden;
  };

  const hide = () => {
    const id = userId();
    if (!id || hidden()) return;
    setOptimisticallyHiddenUserId(id);
    void store.save(id, true);
  };

  return { hidden, hide };
}
