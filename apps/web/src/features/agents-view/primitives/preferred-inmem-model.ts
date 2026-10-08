import { makePersistedState } from '@app/lib/persistence';
import { modelChoiceIsExplicit } from '@core/component/AI/util/plan-model';
import {
  hasSawFreePlan,
  noteSawFreePlan,
} from '@core/component/AI/util/saw-free-plan';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createSignal } from 'solid-js';

const explicitStorageKey = 'agents-view-inmem-model-explicit-v1';

/**
 * The last model chosen from the New conversation **Models** group (Macro's
 * in-memory catalog). Scoped to the signed-in user so a reload keeps that
 * choice as the default until another Models entry is picked.
 *
 * Gemini stored from the free plan is not a choice: it is the only model
 * there. `explicit` is true when the user picked a model while others were
 * available, including Gemini itself.
 */
export function createPreferredInmemModel(userId: string | undefined) {
  const storage = createUserScopedStorage('agents-view-inmem-model-v1');
  const explicitStorage = createUserScopedStorage(explicitStorageKey);
  const [model, setModel] = makePersistedState(
    createSignal<string | undefined>(undefined),
    {
      storages: {
        restore: () => {
          if (!userId) return;
          const stored = storage.read(userId)?.trim();
          return stored || undefined;
        },
        write: (value) => {
          if (!userId) return;
          if (value) storage.write(userId, value);
          else storage.write(userId, '');
        },
      },
    }
  );
  const [explicitFlag, setExplicitFlag] = makePersistedState(
    createSignal(false),
    {
      storages: {
        restore: () => {
          if (!userId) return;
          return explicitStorage.read(userId) === '1';
        },
        write: (value) => {
          if (!userId) return;
          explicitStorage.write(userId, value ? '1' : '');
        },
      },
    }
  );
  const [sawFreePlan, setSawFreePlan] = makePersistedState(
    createSignal(false),
    {
      storages: {
        restore: () => {
          if (!userId) return;
          return hasSawFreePlan(userId);
        },
        write: (value) => {
          if (!userId || !value) return;
          noteSawFreePlan(userId);
        },
      },
    }
  );

  return {
    model,
    /** Whether the stored model is a real picker choice, not the free default. */
    explicit: () => modelChoiceIsExplicit(model(), explicitFlag()),
    sawFreePlan,
    noteFreePlan: () => {
      if (!sawFreePlan()) setSawFreePlan(true);
    },
    remember: (id: string) => {
      const trimmed = id.trim();
      if (!trimmed) return;
      setModel(trimmed);
      setExplicitFlag(true);
    },
  };
}
