import { makePersistedState } from '@app/lib/persistence';
import type { createUserScopedStorage } from '@core/util/userScopedStorage';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  type Setter,
} from 'solid-js';
import {
  type DatabaseViewSelection,
  readViewSelection,
} from '../../database/core/view-selection';

export function createDatabaseViewSelection(
  userId: Accessor<string | undefined>,
  storage: ReturnType<typeof createUserScopedStorage>
) {
  const persisted = createMemo(() => {
    const id = userId();
    return makePersistedState(
      createSignal<DatabaseViewSelection>({ views: {} }),
      {
        storages: {
          restore: () => (id ? readViewSelection(storage.read(id)) : undefined),
          write: (value) => {
            if (id) storage.write(id, JSON.stringify(value));
          },
        },
      }
    );
  });
  const select: Setter<DatabaseViewSelection> = (value) =>
    persisted()[1](value);
  return [() => persisted()[0](), select] as const;
}

/**
 * Open the table and view a link names (`?tableId=…&viewId=…`, what an agent
 * hands out for the table it built) over the remembered selection, whenever
 * the link changes. A link without a view keeps the table's remembered one.
 */
export function followLinkedLocation(
  linked: {
    tableId: Accessor<string | undefined>;
    viewId: Accessor<string | undefined>;
  },
  select: Setter<DatabaseViewSelection>
) {
  createEffect(
    on([linked.tableId, linked.viewId], ([tableId, viewId]) => {
      if (!tableId) return;
      select((current) => ({
        ...current,
        tableId,
        views: viewId ? { ...current.views, [tableId]: viewId } : current.views,
      }));
    })
  );
}
