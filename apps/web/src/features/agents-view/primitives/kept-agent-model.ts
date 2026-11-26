import { makePersistedState } from '@app/lib/persistence';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createStore } from 'solid-js/store';

/** Browser-local choices, isolated by account and agent; never changes an agent's default. */
export function createKeptAgentModels(userId: string | undefined) {
  const storage = createUserScopedStorage('agents-view-kept-model-v1');
  const [models, setModels] = makePersistedState(
    createStore<Record<string, string | undefined>>({}),
    {
      storages: {
        restore: () => {
          if (!userId) return;
          const value: unknown = JSON.parse(storage.read(userId) ?? '{}');
          if (!value || typeof value !== 'object' || Array.isArray(value))
            return;
          return Object.fromEntries(
            Object.entries(value).filter(
              ([agentId, model]) =>
                agentId.length > 0 &&
                typeof model === 'string' &&
                model.length > 0
            )
          );
        },
        write: (value) => {
          if (userId) storage.write(userId, JSON.stringify(value));
        },
      },
    }
  );

  return {
    model: (agentId: string) => {
      // Read the key even while absent so Solid tracks a later keep or forget.
      const model = models[agentId];
      return Object.hasOwn(models, agentId) ? model : undefined;
    },
    keep: (agentId: string, model: string) => {
      if (agentId && model) setModels(agentId, model);
    },
    forget: (agentId: string) => setModels(agentId, undefined),
  };
}
