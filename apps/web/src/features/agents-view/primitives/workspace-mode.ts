import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { makePersistedState } from '@app/lib/persistence';
import { enableComposerAutoMode } from '@core/constant/featureFlags';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createSignal } from 'solid-js';
import type { ComposerMode } from '../core/mode';

const MODES: readonly ComposerMode[] = ['auto', 'chat', 'code'];

/**
 * Whether the new-conversation composer picks the agent kind per prompt
 * (Auto), or always starts chat agents (Chat) or coding agents (Code).
 * Scoped to the signed-in user; a new person starts in Auto, which reads as
 * Chat for anyone without {@link enableComposerAutoMode}.
 */
export function createWorkspaceMode(userId: string | undefined) {
  const storage = createUserScopedStorage('agents-view-mode-v1');
  const autoFlag = useFeatureFlag(enableComposerAutoMode);
  const autoAvailable = () => autoFlag().enabled;
  const [stored, setMode] = makePersistedState(
    createSignal<ComposerMode>('auto'),
    {
      storages: {
        restore: () => {
          if (!userId) return;
          const value = storage.read(userId);
          return MODES.find((mode) => mode === value);
        },
        write: (value) => {
          if (userId) storage.write(userId, value);
        },
      },
    }
  );
  const mode = (): ComposerMode => {
    const value = stored();
    return value === 'auto' && !autoAvailable() ? 'chat' : value;
  };
  return { mode, setMode, autoAvailable };
}
