import { makePersistedState } from '@app/lib/persistence';
import { createSignal } from 'solid-js';
import { isModelSpeed, type ModelSpeed } from '../constant/speed';

const STORAGE_KEY = 'macro:ai-speed';
/** The on/off preference this replaced; `true` meant the fastest tier. */
const LEGACY_FAST_MODE_KEY = 'macro:ai-fast-mode';

function restoreSpeed(): ModelSpeed | undefined {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (isModelSpeed(stored)) return stored;
  if (localStorage.getItem(LEGACY_FAST_MODE_KEY) === 'true') return 'ultrafast';
  return undefined;
}

/**
 * Browser preference shared by all composers. A model that doesn't offer the
 * preferred tier runs at standard.
 */
export const [preferredSpeed, setPreferredSpeed] = makePersistedState(
  createSignal<ModelSpeed>('standard'),
  {
    storages: {
      restore: restoreSpeed,
      write: (value) => {
        localStorage.setItem(STORAGE_KEY, value);
        localStorage.removeItem(LEGACY_FAST_MODE_KEY);
      },
    },
  }
);
