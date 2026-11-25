import { makePersistedState } from '@app/lib/persistence';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createSignal } from 'solid-js';

const RECENT_MODEL_LIMIT = 5;

function modelIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (id): id is string => typeof id === 'string' && id.length > 0
      )
    ),
  ].slice(0, RECENT_MODEL_LIMIT);
}

/** Opaque catalog IDs only; unavailable models are filtered by the current catalog. */
export function createRecentModelSelections(userId: string | undefined) {
  const storage = createUserScopedStorage('agent-model-recent-v1');
  let lastObserved: string | null | undefined;
  const [ids, setIds] = makePersistedState(createSignal<string[]>([]), {
    storages: {
      restore: () => {
        lastObserved = userId ? storage.read(userId) : null;
        return modelIds(JSON.parse(lastObserved ?? '[]'));
      },
      write: (value) => {
        if (userId) storage.write(userId, JSON.stringify(value));
      },
    },
  });
  const refresh = () => {
    if (!userId) return;
    try {
      const stored = storage.read(userId);
      // Failed writes leave storage unchanged; do not replay stale history
      // over selections made in this mounted selector.
      if (stored === lastObserved) return;
      if (stored === null) {
        lastObserved = stored;
        return;
      }
      const restored = modelIds(JSON.parse(stored));
      lastObserved = stored;
      setIds((previous) => modelIds([...restored, ...previous]));
    } catch {
      // A malformed value must not discard the working in-memory selection.
    }
  };
  return {
    ids,
    refresh,
    remember: (id: string) => {
      if (!id) return;
      refresh();
      setIds((previous) => modelIds([id, ...previous]));
    },
  };
}
