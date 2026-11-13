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

/** Open a table, and its view when one is named, keeping other tables' views. */
export function selectLocation(
  select: Setter<DatabaseViewSelection>,
  tableId: string,
  viewId: string | undefined
) {
  select((current) => ({
    ...current,
    tableId,
    views: viewId ? { ...current.views, [tableId]: viewId } : current.views,
  }));
}

/**
 * Open the table and view the route names, over the remembered selection,
 * whenever they change. The viewer's remembered selection restores once
 * their id is known, so the route is applied again then.
 */
export function followRouteLocation(
  route: { tableId: Accessor<string>; viewId: Accessor<string> },
  userId: Accessor<string | undefined>,
  select: Setter<DatabaseViewSelection>
) {
  createEffect(
    on([route.tableId, route.viewId, userId], ([tableId, viewId]) => {
      if (tableId) selectLocation(select, tableId, viewId || undefined);
    })
  );
}
