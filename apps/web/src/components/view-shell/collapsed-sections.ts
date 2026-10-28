import type { PersistenceStorage } from '@app/lib/persistence';
import { addUnique, removeValue } from '@app/lib/signals/store-array-updaters';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import type { Accessor } from 'solid-js';
import { z } from 'zod';

/** View state that remembers which sidebar sections the user folded away. */
export type CollapsedSidebarSectionsState = {
  collapsedSidebarSectionIds: string[];
};

const collapsedSectionsSchema = z.object({
  version: z.literal(1).default(1),
  collapsedSidebarSectionIds: z.array(z.string()).default([]),
});

type CollapsedSectionsPreferences = z.infer<typeof collapsedSectionsSchema>;

const DEFAULT_PREFERENCES: CollapsedSectionsPreferences = {
  version: 1,
  collapsedSidebarSectionIds: [],
};

/** Store updater that folds or unfolds one section by id. */
export const setSidebarSectionCollapsed = (id: string, open: boolean) =>
  open ? removeValue(id) : addUnique(id);

export type CreateCollapsedSidebarSectionsStorageOptions = {
  /** localStorage key prefix; the user id is appended. */
  key: string;
  userId: Accessor<string | undefined>;
  restore: boolean;
};

/**
 * Persists a view's folded sidebar sections per user, separately from the
 * split entry state so the choice survives reloads and every visit.
 */
export function createCollapsedSidebarSectionsStorage<
  TState extends CollapsedSidebarSectionsState,
>(
  options: CreateCollapsedSidebarSectionsStorageOptions
): PersistenceStorage<TState> {
  const storage = createUserScopedStorage(options.key);
  let previous: string | undefined;

  const serialize = (state: TState): string =>
    JSON.stringify({
      version: 1,
      collapsedSidebarSectionIds: [...state.collapsedSidebarSectionIds],
    } satisfies CollapsedSectionsPreferences);

  const parse = (raw: string): CollapsedSectionsPreferences => {
    try {
      const result = collapsedSectionsSchema.safeParse(JSON.parse(raw));
      return result.success ? result.data : DEFAULT_PREFERENCES;
    } catch {
      return DEFAULT_PREFERENCES;
    }
  };

  return {
    restore: (current) => {
      if (!options.restore) return undefined;

      const userId = options.userId();
      if (!userId) return undefined;

      const raw = storage.read(userId);
      if (raw === null) return undefined;

      return {
        ...current,
        collapsedSidebarSectionIds: [...parse(raw).collapsedSidebarSectionIds],
      };
    },
    initialize: (current) => {
      previous = serialize(current);
    },
    write: (current) => {
      const userId = options.userId();
      if (!userId) return;

      const serialized = serialize(current);
      if (serialized === previous) return;

      previous = serialized;
      storage.write(userId, serialized);
    },
  };
}
