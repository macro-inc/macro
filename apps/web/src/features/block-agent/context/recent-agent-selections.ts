import { makePersistedState } from '@app/lib/persistence';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createSignal } from 'solid-js';

const RECENT_AGENT_LIMIT = 5;

/** Successful choices from this composer, scoped to the signed-in user. */
export function createRecentAgentSelections(userId: string | undefined) {
  const storage = createUserScopedStorage('agent-session-recent-v1');
  const [ids, setIds] = makePersistedState(createSignal<string[]>([]), {
    storages: {
      restore: () => {
        if (!userId) return;
        const stored: unknown = JSON.parse(storage.read(userId) ?? '[]');
        if (!Array.isArray(stored)) return;
        return stored
          .filter((id): id is string => typeof id === 'string')
          .slice(0, RECENT_AGENT_LIMIT);
      },
      write: (value) => {
        if (userId) storage.write(userId, JSON.stringify(value));
      },
    },
  });

  return {
    ids,
    remember: (id: string) =>
      setIds((previous) =>
        [id, ...previous.filter((value) => value !== id)].slice(
          0,
          RECENT_AGENT_LIMIT
        )
      ),
  };
}
