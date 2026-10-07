import { makePersistedState } from '@app/lib/persistence';
import type { createUserScopedStorage } from '@core/util/userScopedStorage';
import { type Accessor, createMemo, createSignal, type Setter } from 'solid-js';
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
