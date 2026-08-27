import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';
import {
  type AppLayoutId,
  getAppLayoutDefinition,
  isAppLayoutId,
} from './layout-registry';

const APP_LAYOUT_STORAGE_KEY = 'macro:pref:app-layout-id';
const LEGACY_EXPERIMENT_STORAGE_KEY =
  'macro:pref:experimental-app-layout';

function legacyInitialLayout(): AppLayoutId {
  if (typeof localStorage === 'undefined') return 'classic';
  const legacyValue = localStorage.getItem(LEGACY_EXPERIMENT_STORAGE_KEY);
  if (legacyValue === null) return 'classic';

  try {
    return JSON.parse(legacyValue) === true ? 'experimental-v1' : 'classic';
  } catch {
    return legacyValue === 'true' ? 'experimental-v1' : 'classic';
  }
}

const [persistedAppLayoutId, setPersistedAppLayoutId] = makePersisted(
  createSignal<AppLayoutId>(legacyInitialLayout()),
  {
    name: APP_LAYOUT_STORAGE_KEY,
    deserialize(value) {
      try {
        const parsed = JSON.parse(value);
        return isAppLayoutId(parsed) ? parsed : 'classic';
      } catch {
        return isAppLayoutId(value) ? value : 'classic';
      }
    },
  }
);

/** The device-local desktop layout preference. */
export const selectedAppLayoutId = (): AppLayoutId => {
  const selected = persistedAppLayoutId();
  return isAppLayoutId(selected) ? selected : 'classic';
};

/** Mobile and touch surfaces always retain the Classic layout. */
export const effectiveAppLayoutId = (): AppLayoutId =>
  isTouchDevice() ? 'classic' : selectedAppLayoutId();

/** Resolve the active layout definition and its registered surfaces. */
export const activeAppLayout = () =>
  getAppLayoutDefinition(effectiveAppLayoutId());

/** Persist a registered app layout. Unknown ids safely select Classic. */
export function selectAppLayout(id: AppLayoutId): AppLayoutId {
  const next = isAppLayoutId(id) ? id : 'classic';
  setPersistedAppLayoutId(next);
  return next;
}
