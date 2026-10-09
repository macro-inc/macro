import { makePersistedState } from '@app/lib/persistence';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createSignal } from 'solid-js';
import type { AgentsMode } from '../core/mode';

/**
 * Whether the new-conversation composer starts chat agents (Chat) or coding
 * agents (Code). Scoped to the signed-in user; a new person starts in Chat.
 */
export function createWorkspaceMode(userId: string | undefined) {
  const storage = createUserScopedStorage('agents-view-mode-v1');
  const [mode, setMode] = makePersistedState(createSignal<AgentsMode>('chat'), {
    storages: {
      restore: () => {
        if (!userId) return;
        return storage.read(userId) === 'code' ? 'code' : undefined;
      },
      write: (value) => {
        if (userId) storage.write(userId, value);
      },
    },
  });
  return { mode, setMode };
}
