import { makePersistedState } from '@app/lib/persistence';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createSignal } from 'solid-js';
import { type AgentsMode, parseAgentsMode } from '../core/mode';

/**
 * Which half of the workspace is showing, remembered per user on this device
 * so coming back lands where you left off.
 */
export function createAgentsMode(userId: string | undefined) {
  const storage = createUserScopedStorage('agents-view-mode-v1');
  const [mode, setMode] = makePersistedState(createSignal<AgentsMode>('chat'), {
    storages: {
      restore: () => {
        if (!userId) return;
        const stored = storage.read(userId);
        return stored === null ? undefined : parseAgentsMode(stored);
      },
      write: (value) => {
        if (userId) storage.write(userId, value);
      },
    },
  });

  return { mode, setMode };
}
