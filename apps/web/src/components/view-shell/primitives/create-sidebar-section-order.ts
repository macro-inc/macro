import {
  makePersistedState,
  type PersistenceStorage,
} from '@app/lib/persistence';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { z } from 'zod';

const sectionOrderSchema = z.object({
  version: z.literal(1),
  order: z.array(z.string()),
});

export function createSidebarSectionOrderStorage(
  view: string,
  userId: string | undefined
): PersistenceStorage<string[]> {
  const storage = createUserScopedStorage(`sidebar-section-order:${view}`);
  return {
    restore: () => {
      if (!userId) return;
      const raw = storage.read(userId);
      if (raw === null) return;
      try {
        const parsed = sectionOrderSchema.safeParse(JSON.parse(raw));
        if (parsed.success) return [...new Set(parsed.data.order)];
      } catch {
        // Invalid preferences do not prevent the default navigation from opening.
      }
    },
    write: (order) => {
      if (!userId) return;
      storage.write(userId, JSON.stringify({ version: 1, order }));
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
    const [order, setOrder] = makePersistedState(createSignal<string[]>([]), {
      storages: createSidebarSectionOrderStorage(view, userId),
    });
    return { order, setOrder };
  });
  return {
    account: owner,
    order: () => owner().order(),
    setOrder: (order: string[]) => owner().setOrder(order),
  };
}
