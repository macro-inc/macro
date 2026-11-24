import { makePersistedState } from '@app/lib/persistence';
import { currentModelId } from '@core/component/AI/constant';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createSignal } from 'solid-js';

/**
 * The last model chosen from the New conversation **Models** group (Macro's
 * in-memory catalog). Scoped to the signed-in user so a reload keeps that
 * choice as the default until another Models entry is picked. A choice of a
 * model that has since been retired restores as its replacement.
 */
export function createPreferredInmemModel(userId: string | undefined) {
  const storage = createUserScopedStorage('agents-view-inmem-model-v1');
  const [model, setModel] = makePersistedState(
    createSignal<string | undefined>(undefined),
    {
      storages: {
        restore: () => {
          if (!userId) return;
          const stored = storage.read(userId)?.trim();
          return stored ? currentModelId(stored) : undefined;
        },
        write: (value) => {
          if (!userId) return;
          if (value) storage.write(userId, value);
          else storage.write(userId, '');
        },
      },
    }
  );

  return {
    model,
    remember: (id: string) => setModel(id.trim() || undefined),
  };
}
