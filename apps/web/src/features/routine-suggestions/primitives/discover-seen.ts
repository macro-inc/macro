import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { type Accessor, createSignal } from 'solid-js';
import { parseSeenPicks, seenAfterShowing } from '../core/discover';

const STORAGE = createUserScopedStorage('routine-suggestions:discover-seen:v1');

/**
 * The AI picks the person has seen on Discover, saved per user in this
 * browser: Discover's tab marks new ones until it is opened.
 */
export function createDiscoverSeen(userId: Accessor<string | undefined>) {
  const [saved, setSaved] = createSignal<{ userId: string; ids: string[] }>();
  return {
    /** Undefined until the user is known. */
    seen(): string[] | undefined {
      const id = userId();
      if (!id) return undefined;
      const current = saved();
      return current?.userId === id
        ? current.ids
        : parseSeenPicks(STORAGE.read(id));
    },
    /** Discover showed these picks. */
    markSeen(picks: readonly string[]) {
      const id = userId();
      if (!id) return;
      const ids = seenAfterShowing(picks);
      STORAGE.write(id, JSON.stringify(ids));
      setSaved({ userId: id, ids });
    },
  };
}
