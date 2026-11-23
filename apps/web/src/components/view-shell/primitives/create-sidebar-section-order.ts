import {
  makePersistedState,
  type PersistenceStorage,
} from '@app/lib/persistence';
import {
  createUserScopedStorage,
  userScopedStorageKey,
} from '@core/util/userScopedStorage';
import { type Accessor, createMemo, createSignal, onCleanup } from 'solid-js';
import { z } from 'zod';

const sectionOrderSchema = z.object({
  version: z.literal(1),
  order: z.array(z.string()),
});

function parseSectionOrder(raw: string | null): string[] | undefined {
  if (raw === null) return;
  try {
    const parsed = sectionOrderSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return [...new Set(parsed.data.order)];
  } catch {
    // Invalid preferences do not prevent the default navigation from opening.
  }
}

function storagePrefix(view: string) {
  return `sidebar-section-order:${view}`;
}

export function createSidebarSectionOrderStorage(
  view: string,
  userId: string | undefined
): PersistenceStorage<string[]> {
  const storage = createUserScopedStorage(storagePrefix(view));
  return {
    restore: () =>
      userId ? parseSectionOrder(storage.read(userId)) : undefined,
    write: (order) => {
      if (!userId) return;
      const raw = JSON.stringify({ version: 1, order });
      storage.write(userId, raw);
      // Native storage events reach other tabs, but not other splits in this document.
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: userScopedStorageKey(storagePrefix(view), userId),
          newValue: raw,
        })
      );
    },
  };
}

/** Replace the entire preference owner on account changes, including A → B → A. */
export function createSidebarSectionOrder(options: {
  view: Accessor<string>;
  userId: Accessor<string | undefined>;
}) {
  const owner = createMemo(() => {
    const view = options.view();
    const userId = options.userId();
    const state = createSignal<string[]>([]);
    const [order, setOrder] = makePersistedState(state, {
      storages: createSidebarSectionOrderStorage(view, userId),
    });
    if (userId) {
      const key = userScopedStorageKey(storagePrefix(view), userId);
      const update = (event: StorageEvent) => {
        if (event.storageArea && event.storageArea !== window.localStorage)
          return;
        if (event.key !== key && event.key !== null) return;
        const next = parseSectionOrder(event.newValue) ?? [];
        const current = order();
        if (
          current.length === next.length &&
          current.every((value, index) => value === next[index])
        )
          return;
        // Read notifications without persisting again, avoiding cross-split write loops.
        state[1](next);
      };
      window.addEventListener('storage', update);
      onCleanup(() => window.removeEventListener('storage', update));
    }
    return { order, setOrder };
  });
  return {
    account: owner,
    order: () => owner().order(),
    setOrder: (order: string[]) => owner().setOrder(order),
  };
}
