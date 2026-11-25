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
  const [ids, setIds] = makePersistedState(createSignal<string[]>([]), {
    storages: {
      restore: () =>
        userId ? modelIds(JSON.parse(storage.read(userId) ?? '[]')) : [],
      write: (value) => {
        if (userId) storage.write(userId, JSON.stringify(value));
      },
    },
  });
  const refresh = () => {
    if (!userId) return;
    try {
      const stored = storage.read(userId);
      if (stored === null) return;
      const restored = modelIds(JSON.parse(stored));
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
