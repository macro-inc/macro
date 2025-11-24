import { createSignal } from 'solid-js';

// Re-export from unified panel for backward compatibility
export { isRightPanelOpen, useToggleRightPanel } from './unifiedPanel';

const DEFAULT_RIGHT_PANEL_SIZE = 600;

export const [storedRightPanelSize, setStoredRightPanelSize] = createSignal(
  DEFAULT_RIGHT_PANEL_SIZE
);

// default to closed right bar
// NOTE: this is no longer persisted to local storage
export const [persistedLayoutSizes, setPersistedLayoutSizes] = createSignal<
  [number, number]
>([1, 0]);