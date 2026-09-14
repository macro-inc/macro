import { makePersistedState } from '@app/lib/persistence';
import { pressedKeys } from '@core/hotkey/state';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createSignal } from 'solid-js';
import {
  effectiveSessionStartMode,
  parseSessionStartMode,
  SESSION_START_MODE_STORAGE_KEY,
  type SessionStartMode,
} from './session-start-mode';

/**
 * Committed live/background choice for the session composer, persisted per
 * user on this device. Cmd/Ctrl previews background without writing storage.
 */
export function createSessionStartMode(
  userId: string | undefined,
  cmdHeld: () => boolean = () => pressedKeys().has('cmd')
) {
  const storage = createUserScopedStorage(SESSION_START_MODE_STORAGE_KEY);
  const [committed, setCommitted] = makePersistedState(
    createSignal<SessionStartMode>('live'),
    {
      storages: {
        restore: () => {
          if (!userId) return;
          return parseSessionStartMode(storage.read(userId));
        },
        write: (value) => {
          if (userId) storage.write(userId, value);
        },
      },
    }
  );

  return {
    committed,
    setCommitted,
    effective: () => effectiveSessionStartMode(committed(), cmdHeld()),
  };
}
