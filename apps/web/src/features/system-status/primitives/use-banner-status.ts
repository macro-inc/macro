import {
  makePersistedState,
  type PersistenceStorage,
} from '@app/lib/persistence';
import { useCurrentSystemStatusQuery } from '@queries/system-status/status';
import { createEffect, createSignal, on } from 'solid-js';
import { z } from 'zod';
import { type BannerStatus, bannerStatus } from '../core/status';

const DISMISSED_STORAGE_KEY = 'macro:system-status:dismissed';

const dismissedIdSchema = z.string().min(1);

/**
 * The dismissed banner's id in localStorage, shared by every account on this
 * device since the status is the same for everyone. Storage failures degrade
 * to not remembering the dismissal.
 */
const DISMISSED_STORAGE: PersistenceStorage<string | undefined> = {
  restore: () => {
    try {
      const result = dismissedIdSchema.safeParse(
        localStorage.getItem(DISMISSED_STORAGE_KEY)
      );
      return result.success ? result.data : undefined;
    } catch {
      return undefined;
    }
  },
  write: (id) => {
    try {
      if (id) localStorage.setItem(DISMISSED_STORAGE_KEY, id);
      else localStorage.removeItem(DISMISSED_STORAGE_KEY);
    } catch {
      // Unavailable storage only loses the dismissal across reloads.
    }
  },
};

/**
 * The banner every user sees while Macro is not operational. Never suspends:
 * until the status loads, and through failed refetches, it shows whatever was
 * last known (nothing at first).
 *
 * Dismissing hides that alert across reloads, remembered by its id. Once a
 * loaded status shows a different alert, or none, the stored id has expired
 * and is cleared, so every new alert shows.
 */
export function useBannerStatus(): {
  status: () => BannerStatus | undefined;
  dismiss: () => void;
} {
  const query = useCurrentSystemStatusQuery();
  const [dismissedId, setDismissedId] = makePersistedState(
    createSignal<string>(),
    { storages: DISMISSED_STORAGE }
  );
  const loaded = () => !query.isPending && query.data !== undefined;
  const current = () =>
    !query.isPending && query.data ? bannerStatus(query.data) : undefined;

  createEffect(
    on([loaded, () => current()?.id], ([isLoaded, id]) => {
      if (isLoaded && dismissedId() !== undefined && dismissedId() !== id) {
        setDismissedId(undefined);
      }
    })
  );

  const status = () => {
    const banner = current();
    return banner && banner.id === dismissedId() ? undefined : banner;
  };
  return { status, dismiss: () => setDismissedId(current()?.id) };
}
